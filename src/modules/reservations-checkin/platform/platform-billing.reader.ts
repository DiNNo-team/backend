import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  APPROVED,
  SUSPENDED,
  type RestaurantApprovalStatus,
} from '../../identity-access/index.js';
import type { RestaurantCategory } from '../../restaurant-operations/index.js';
import {
  monthStartInstant,
  shiftMonth,
  type BillingMonth,
} from '../billing/billing-month.js';
import type { BillingPeriodStatus } from '../billing/billing-period.entity.js';
import { REPORT_TIMEZONE } from '../reports/report-period.js';

// Los restaurantes que se cobran y que ve el directorio: los que alguna vez
// operaron. Un pendiente o un rechazado nunca tuvo check-ins.
export const BILLABLE_STATUSES: RestaurantApprovalStatus[] = [
  APPROVED,
  SUSPENDED,
];

export interface MonthTotalsRow {
  month: string;
  revenueCop: number;
  checkIns: number;
}

export interface BillingListRow {
  restaurantId: string;
  name: string;
  approvalStatus: RestaurantApprovalStatus;
  checkIns: number;
  amountCop: number;
  periodStatus: BillingPeriodStatus | null;
  paidAt: Date | null;
}

export interface MonthStatusTotals {
  paidCop: number;
  pendingCop: number;
}

export interface RestaurantHeader {
  id: string;
  name: string;
  approvalStatus: RestaurantApprovalStatus;
}

export interface BillingPeriodRow {
  status: BillingPeriodStatus;
  amountCopSnapshot: number | null;
  checkInsSnapshot: number | null;
  markedPaidAt: Date | null;
}

export interface ActivityRow {
  id: string;
  name: string;
  category: RestaurantCategory | null;
  approvalStatus: RestaurantApprovalStatus;
  isOpen: boolean;
  approvedAt: Date | null;
  createdAt: Date;
  checkIns: number;
  amountCop: number;
  lastTableActivityAt: Date | null;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

// The sums are bigint in Postgres (text in pg); they fit a number with room.
const toNumber = (value: string | number | null): number => Number(value ?? 0);

// Totales de check-ins de cada restaurante en el rango del mes; la base de las
// listas del cobro y del directorio. $1 y $2: el rango [inicio, fin) del mes.
const MONTH_TOTALS_BY_RESTAURANT = `SELECT "restaurant_id", COUNT(*)::int AS "check_ins", SUM("fee_cop")::bigint AS "amount"
  FROM "check_ins"
  WHERE "checked_in_at" >= $1 AND "checked_in_at" < $2
  GROUP BY "restaurant_id"`;

// Lecturas de solo lectura del panel del administrador sobre check_ins,
// reservations y billing_periods (de este módulo) y, por SQL de solo lectura,
// restaurants, tables y table_logs (de restaurant-operations), igual que
// BillingStatementService lee tables. Nunca escribe y nunca trae datos de
// comensales: ni diner_id, ni el código de la reserva, ni correos.
//
// El dinero es siempre SUM(check_ins.fee_cop), el total guardado en cada
// check-in: cambiar CHECKIN_FEE_PER_GUEST_COP no altera los meses anteriores.
@Injectable()
export class PlatformBillingReader {
  constructor(private readonly dataSource: DataSource) {}

  // Ingresos y check-ins de cada mes de [firstKey, lastKey], también los meses
  // en 0. Los meses se cuentan en Bogotá con date_trunc; el WHERE por rango
  // usa IDX_check_ins_checked_in_at.
  async monthlyTotals(
    firstKey: string,
    lastKey: string,
  ): Promise<MonthTotalsRow[]> {
    const rows = await this.dataSource.query<
      { month: string; revenue_cop: string; check_ins: number }[]
    >(
      `WITH "months" AS (
         SELECT generate_series($1::date, $2::date, interval '1 month')::date AS "month"
       ), "totals" AS (
         SELECT date_trunc('month', "checked_in_at" AT TIME ZONE '${REPORT_TIMEZONE}')::date AS "month",
                COUNT(*)::int AS "check_ins", SUM("fee_cop")::bigint AS "revenue"
         FROM "check_ins"
         WHERE "checked_in_at" >= $3 AND "checked_in_at" < $4
         GROUP BY 1
       )
       SELECT to_char(m."month", 'YYYY-MM') AS "month",
              COALESCE(t."revenue", 0)::text AS "revenue_cop",
              COALESCE(t."check_ins", 0)::int AS "check_ins"
       FROM "months" m
       LEFT JOIN "totals" t ON t."month" = m."month"
       ORDER BY m."month"`,
      [
        `${firstKey}-01`,
        `${lastKey}-01`,
        monthStartInstant(firstKey),
        monthStartInstant(shiftMonth(lastKey, 1)),
      ],
    );
    return rows.map((row) => ({
      month: row.month,
      revenueCop: toNumber(row.revenue_cop),
      checkIns: row.check_ins,
    }));
  }

  // Cuántos restaurantes hay en cada estado de aprobación.
  async restaurantCounts(): Promise<
    Partial<Record<RestaurantApprovalStatus, number>>
  > {
    const rows = await this.dataSource.query<
      { approval_status: RestaurantApprovalStatus; count: number }[]
    >(
      `SELECT "approval_status", COUNT(*)::int AS "count" FROM "restaurants" GROUP BY "approval_status"`,
    );
    return Object.fromEntries(
      rows.map((row) => [row.approval_status, row.count]),
    );
  }

  // Lo cobrado: la suma de los snapshots de los meses marcados como cobrados,
  // de los meses cerrados (antes de currentKey) de los restaurantes cobrables.
  async collectedCop(currentKey: string): Promise<number> {
    const [row] = await this.dataSource.query<{ amount: string }[]>(
      `SELECT COALESCE(SUM(bp."amount_cop_snapshot"), 0)::text AS "amount"
       FROM "billing_periods" bp
       JOIN "restaurants" r ON r."id" = bp."restaurant_id"
       WHERE bp."status" = 'paid' AND bp."period_month" < $1::date
         AND r."approval_status" = ANY($2)`,
      [`${currentKey}-01`, BILLABLE_STATUSES],
    );
    return toNumber(row.amount);
  }

  // Lo pendiente: el monto recalculado de cada restaurante y mes cerrado
  // [firstKey, currentKey) que no está marcado como cobrado.
  async pendingCop(firstKey: string, currentKey: string): Promise<number> {
    const [row] = await this.dataSource.query<{ amount: string }[]>(
      `SELECT COALESCE(SUM(t."amount"), 0)::text AS "amount"
       FROM (
         SELECT "restaurant_id",
                date_trunc('month', "checked_in_at" AT TIME ZONE '${REPORT_TIMEZONE}')::date AS "month",
                SUM("fee_cop")::bigint AS "amount"
         FROM "check_ins"
         WHERE "checked_in_at" >= $1 AND "checked_in_at" < $2
         GROUP BY 1, 2
       ) t
       JOIN "restaurants" r ON r."id" = t."restaurant_id" AND r."approval_status" = ANY($3)
       LEFT JOIN "billing_periods" bp
         ON bp."restaurant_id" = t."restaurant_id" AND bp."period_month" = t."month" AND bp."status" = 'paid'
       WHERE bp."id" IS NULL`,
      [
        monthStartInstant(firstKey),
        monthStartInstant(currentKey),
        BILLABLE_STATUSES,
      ],
    );
    return toNumber(row.amount);
  }

  // Una página del cobro del mes: cada restaurante cobrable con sus check-ins y
  // su monto (también en 0), de mayor a menor monto; desempate por nombre e id.
  async billingPage(
    month: BillingMonth,
    page: number,
    pageSize: number,
  ): Promise<Page<BillingListRow>> {
    const rows = await this.dataSource.query<
      {
        restaurant_id: string;
        name: string;
        approval_status: RestaurantApprovalStatus;
        check_ins: number;
        amount_cop: string;
        period_status: BillingPeriodStatus | null;
        marked_paid_at: Date | null;
        total: number;
      }[]
    >(
      `SELECT r."id" AS "restaurant_id", r."name", r."approval_status",
              COALESCE(t."check_ins", 0)::int AS "check_ins",
              COALESCE(t."amount", 0)::text AS "amount_cop",
              bp."status" AS "period_status", bp."marked_paid_at",
              COUNT(*) OVER ()::int AS "total"
       FROM "restaurants" r
       LEFT JOIN (${MONTH_TOTALS_BY_RESTAURANT}) t ON t."restaurant_id" = r."id"
       LEFT JOIN "billing_periods" bp ON bp."restaurant_id" = r."id" AND bp."period_month" = $3::date
       WHERE r."approval_status" = ANY($4)
       ORDER BY COALESCE(t."amount", 0) DESC, r."name" ASC, r."id" ASC
       LIMIT $5 OFFSET $6`,
      [
        month.period.startsAt,
        month.period.endsBefore,
        month.firstDay,
        BILLABLE_STATUSES,
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    return {
      rows: rows.map((row) => ({
        restaurantId: row.restaurant_id,
        name: row.name,
        approvalStatus: row.approval_status,
        checkIns: row.check_ins,
        amountCop: toNumber(row.amount_cop),
        periodStatus: row.period_status,
        paidAt: row.marked_paid_at,
      })),
      total: rows[0]?.total ?? (await this.billableCount()),
    };
  }

  // Lo cobrado (snapshots) y lo pendiente (recalculado) de un mes cerrado, de
  // todos los restaurantes cobrables.
  async monthStatusTotals(month: BillingMonth): Promise<MonthStatusTotals> {
    const [row] = await this.dataSource.query<
      { paid_cop: string; pending_cop: string }[]
    >(
      `SELECT COALESCE(SUM(bp."amount_cop_snapshot") FILTER (WHERE bp."status" = 'paid'), 0)::text AS "paid_cop",
              COALESCE(SUM(t."amount") FILTER (WHERE bp."status" IS DISTINCT FROM 'paid'), 0)::text AS "pending_cop"
       FROM "restaurants" r
       LEFT JOIN (${MONTH_TOTALS_BY_RESTAURANT}) t ON t."restaurant_id" = r."id"
       LEFT JOIN "billing_periods" bp ON bp."restaurant_id" = r."id" AND bp."period_month" = $3::date
       WHERE r."approval_status" = ANY($4)`,
      [
        month.period.startsAt,
        month.period.endsBefore,
        month.firstDay,
        BILLABLE_STATUSES,
      ],
    );
    return {
      paidCop: toNumber(row.paid_cop),
      pendingCop: toNumber(row.pending_cop),
    };
  }

  // Id, nombre y estado de un restaurante (cualquier estado); null si no existe.
  async restaurantHeader(id: string): Promise<RestaurantHeader | null> {
    const [row] = await this.dataSource.query<
      { id: string; name: string; approval_status: RestaurantApprovalStatus }[]
    >(
      `SELECT "id", "name", "approval_status" FROM "restaurants" WHERE "id" = $1`,
      [id],
    );
    return row
      ? { id: row.id, name: row.name, approvalStatus: row.approval_status }
      : null;
  }

  // La fila de cobro de un restaurante en un mes; null si nadie la marcó nunca.
  async billingPeriod(
    restaurantId: string,
    month: BillingMonth,
  ): Promise<BillingPeriodRow | null> {
    const [row] = await this.dataSource.query<
      {
        status: BillingPeriodStatus;
        amount_cop_snapshot: number | null;
        check_ins_snapshot: number | null;
        marked_paid_at: Date | null;
      }[]
    >(
      `SELECT "status", "amount_cop_snapshot", "check_ins_snapshot", "marked_paid_at"
       FROM "billing_periods"
       WHERE "restaurant_id" = $1 AND "period_month" = $2::date`,
      [restaurantId, month.firstDay],
    );
    return row
      ? {
          status: row.status,
          amountCopSnapshot: row.amount_cop_snapshot,
          checkInsSnapshot: row.check_ins_snapshot,
          markedPaidAt: row.marked_paid_at,
        }
      : null;
  }

  // Una página del directorio: restaurantes cobrables por nombre, con su
  // actividad del mes y el último cambio de sus mesas (MAX de la bitácora).
  // approvedAt es reviewed_at: la aprobación por un administrador (reactivar no
  // la cambia); null si lo aprobó el equipo o la migración.
  async activityPage(
    month: BillingMonth,
    page: number,
    pageSize: number,
  ): Promise<Page<ActivityRow>> {
    const rows = await this.dataSource.query<
      {
        id: string;
        name: string;
        category: RestaurantCategory | null;
        approval_status: RestaurantApprovalStatus;
        is_open: boolean;
        reviewed_at: Date | null;
        created_at: Date;
        check_ins: number;
        amount_cop: string;
        last_table_activity_at: Date | null;
        total: number;
      }[]
    >(
      `SELECT r."id", r."name", r."category", r."approval_status", r."is_open",
              r."reviewed_at", r."created_at",
              COALESCE(t."check_ins", 0)::int AS "check_ins",
              COALESCE(t."amount", 0)::text AS "amount_cop",
              (SELECT MAX(l."changed_at")
                 FROM "table_logs" l
                 JOIN "tables" tb ON tb."id" = l."table_id"
                WHERE tb."restaurant_id" = r."id") AS "last_table_activity_at",
              COUNT(*) OVER ()::int AS "total"
       FROM "restaurants" r
       LEFT JOIN (${MONTH_TOTALS_BY_RESTAURANT}) t ON t."restaurant_id" = r."id"
       WHERE r."approval_status" = ANY($3)
       ORDER BY r."name" ASC, r."id" ASC
       LIMIT $4 OFFSET $5`,
      [
        month.period.startsAt,
        month.period.endsBefore,
        BILLABLE_STATUSES,
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    return {
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        approvalStatus: row.approval_status,
        isOpen: row.is_open,
        approvedAt: row.reviewed_at,
        createdAt: row.created_at,
        checkIns: row.check_ins,
        amountCop: toNumber(row.amount_cop),
        lastTableActivityAt: row.last_table_activity_at,
      })),
      total: rows[0]?.total ?? (await this.billableCount()),
    };
  }

  // Total de restaurantes cobrables, para una página vacía (más allá del final).
  private async billableCount(): Promise<number> {
    const [row] = await this.dataSource.query<{ count: number }[]>(
      `SELECT COUNT(*)::int AS "count" FROM "restaurants" WHERE "approval_status" = ANY($1)`,
      [BILLABLE_STATUSES],
    );
    return row.count;
  }
}
