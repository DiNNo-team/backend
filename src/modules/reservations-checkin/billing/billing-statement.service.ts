import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ReportPeriod } from '../reports/report-period.js';

export interface CheckInTotals {
  checkIns: number;
  amountCop: number;
}

export interface BillingItem {
  checkInId: string;
  reservationId: string;
  checkedInAt: string;
  partySize: number;
  tableIdentifier: string;
  feeCop: number;
}

export interface BillingStatement {
  totalCheckIns: number;
  amountCop: number;
  items: BillingItem[];
}

export interface BillingPage {
  page: number;
  pageSize: number;
}

interface CheckInTotalsRow {
  check_ins: number;
  amount_cop: string;
}

interface BillingRow {
  check_in_id: string;
  reservation_id: string;
  checked_in_at: Date;
  party_size: number;
  table_identifier: string;
  fee_cop: number;
}

// Estado de cuenta del restaurante (CLAUDE.md §11, "Cobro por check-in"): los
// check-ins del periodo con la tarifa que se guardó en cada uno. Nunca trae datos
// del comensal. Los totales son de todo el periodo, no de la página.
//
// El identificador de la mesa se lee de "tables" (restaurant-operations) en la
// misma consulta, solo lectura, como ReservationLabelsReader: es el actual.
@Injectable()
export class BillingStatementService {
  constructor(private readonly dataSource: DataSource) {}

  // Check-ins con checked_in_at dentro del periodo y la suma de la tarifa
  // guardada en cada uno (fee_cop). También la usa el resumen del restaurante.
  async totals(
    restaurantId: string,
    period: ReportPeriod,
  ): Promise<CheckInTotals> {
    const [row] = await this.dataSource.query<CheckInTotalsRow[]>(
      `SELECT COUNT(*)::int AS "check_ins", COALESCE(SUM("fee_cop"), 0)::text AS "amount_cop"
       FROM "check_ins"
       WHERE "restaurant_id" = $1 AND "checked_in_at" >= $2 AND "checked_in_at" < $3`,
      [restaurantId, period.startsAt, period.endsBefore],
    );
    // La suma es bigint (texto en pg); cabe de sobra en un number.
    return { checkIns: row.check_ins, amountCop: Number(row.amount_cop) };
  }

  async statement(
    restaurantId: string,
    period: ReportPeriod,
    { page, pageSize }: BillingPage,
  ): Promise<BillingStatement> {
    const [totals, rows] = await Promise.all([
      this.totals(restaurantId, period),
      this.dataSource.query<BillingRow[]>(
        `SELECT c."id" AS "check_in_id", c."reservation_id", c."checked_in_at", c."fee_cop",
                r."party_size", t."identifier" AS "table_identifier"
         FROM "check_ins" c
         JOIN "reservations" r ON r."id" = c."reservation_id"
         JOIN "tables" t ON t."id" = r."table_id"
         WHERE c."restaurant_id" = $1 AND c."checked_in_at" >= $2 AND c."checked_in_at" < $3
         ORDER BY c."checked_in_at" DESC, c."id" DESC
         LIMIT $4 OFFSET $5`,
        [
          restaurantId,
          period.startsAt,
          period.endsBefore,
          pageSize,
          (page - 1) * pageSize,
        ],
      ),
    ]);
    return {
      totalCheckIns: totals.checkIns,
      amountCop: totals.amountCop,
      items: rows.map((row) => ({
        checkInId: row.check_in_id,
        reservationId: row.reservation_id,
        checkedInAt: new Date(row.checked_in_at).toISOString(),
        partySize: row.party_size,
        tableIdentifier: row.table_identifier,
        feeCop: row.fee_cop,
      })),
    };
  }
}
