import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  monthStartInstant,
  monthsEndingAt,
  shiftMonth,
} from '../billing/billing-month.js';
import { REPORT_TIMEZONE, type ReportPeriod } from './report-period.js';

export interface PeriodTotals {
  reservationsCreated: number;
  checkIns: number;
  guests: number;
  amountCop: number;
}

export interface DailyActivity {
  date: string;
  reservationsCreated: number;
  checkIns: number;
  guests: number;
  cancelled: number;
  expired: number;
}

export interface MonthlyGuests {
  month: string;
  guests: number;
  checkIns: number;
}

interface PeriodTotalsRow {
  reservations_created: number;
  check_ins: number;
  guests: number;
  amount_cop: string;
}

// Lecturas de solo lectura del resumen de la pantalla del restaurante, siempre
// de UN restaurante (el de la sesión) y siempre agregadas: nunca trae filas de
// reservas ni datos del comensal. Los comensales de un check-in son las
// personas (party_size) de su reserva. El día y el mes son los de Bogotá
// (AT TIME ZONE); el WHERE por rango usa los instantes UTC, así cada consulta
// usa IDX_reservations_restaurant_id_created_at e
// IDX_check_ins_restaurant_id_checked_in_at. Cada SQL empieza con un comentario
// que lo nombra (las pruebas e2e simuladas se guían por él).
@Injectable()
export class RestaurantSummaryReader {
  constructor(private readonly dataSource: DataSource) {}

  // Totales de un periodo: reservas creadas, check-ins, sus comensales y la
  // suma de la tarifa guardada. Se usa para el periodo y para el tramo anterior.
  async totals(
    restaurantId: string,
    period: Pick<ReportPeriod, 'startsAt' | 'endsBefore'>,
  ): Promise<PeriodTotals> {
    const [row] = await this.dataSource.query<PeriodTotalsRow[]>(
      `/* summary:totals */
       SELECT (SELECT COUNT(*)::int FROM "reservations"
                WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3) AS "reservations_created",
              c."check_ins", c."guests", c."amount_cop"
       FROM (
         SELECT COUNT(*)::int AS "check_ins",
                COALESCE(SUM(r."party_size"), 0)::int AS "guests",
                COALESCE(SUM(ci."fee_cop"), 0)::text AS "amount_cop"
         FROM "check_ins" ci
         JOIN "reservations" r ON r."id" = ci."reservation_id"
         WHERE ci."restaurant_id" = $1 AND ci."checked_in_at" >= $2 AND ci."checked_in_at" < $3
       ) c`,
      [restaurantId, period.startsAt, period.endsBefore],
    );
    return {
      reservationsCreated: row.reservations_created,
      checkIns: row.check_ins,
      guests: row.guests,
      amountCop: Number(row.amount_cop),
    };
  }

  // Una entrada por CADA día del periodo (generate_series), con 0 en los días
  // sin datos. Las reservas (creadas, canceladas, vencidas) van en el día en que
  // se CREARON; los check-ins y sus comensales, en el día del check-in.
  async daily(
    restaurantId: string,
    period: ReportPeriod,
  ): Promise<DailyActivity[]> {
    const rows = await this.dataSource.query<
      {
        date: string;
        reservations_created: number;
        check_ins: number;
        guests: number;
        cancelled: number;
        expired: number;
      }[]
    >(
      `/* summary:daily */
       SELECT to_char(d."day", 'YYYY-MM-DD') AS "date",
              COALESCE(r."created", 0)::int AS "reservations_created",
              COALESCE(c."check_ins", 0)::int AS "check_ins",
              COALESCE(c."guests", 0)::int AS "guests",
              COALESCE(r."cancelled", 0)::int AS "cancelled",
              COALESCE(r."expired", 0)::int AS "expired"
       FROM generate_series($4::date, $5::date, interval '1 day') AS d("day")
       LEFT JOIN (
         SELECT ("created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::date AS "day",
                COUNT(*)::int AS "created",
                COUNT(*) FILTER (WHERE "status" = 'cancelled')::int AS "cancelled",
                COUNT(*) FILTER (WHERE "status" = 'expired')::int AS "expired"
         FROM "reservations"
         WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3
         GROUP BY 1
       ) r ON r."day" = d."day"::date
       LEFT JOIN (
         SELECT (ci."checked_in_at" AT TIME ZONE '${REPORT_TIMEZONE}')::date AS "day",
                COUNT(*)::int AS "check_ins",
                SUM(rv."party_size")::int AS "guests"
         FROM "check_ins" ci
         JOIN "reservations" rv ON rv."id" = ci."reservation_id"
         WHERE ci."restaurant_id" = $1 AND ci."checked_in_at" >= $2 AND ci."checked_in_at" < $3
         GROUP BY 1
       ) c ON c."day" = d."day"::date
       ORDER BY d."day"`,
      [
        restaurantId,
        period.startsAt,
        period.endsBefore,
        period.from,
        period.to,
      ],
    );
    return rows.map((row) => ({
      date: row.date,
      reservationsCreated: row.reservations_created,
      checkIns: row.check_ins,
      guests: row.guests,
      cancelled: row.cancelled,
      expired: row.expired,
    }));
  }

  // Los `count` meses (AAAA-MM) que terminan en `lastKey`, también los meses en
  // 0, con los comensales y los check-ins de cada uno.
  async monthly(
    restaurantId: string,
    lastKey: string,
    count: number,
  ): Promise<MonthlyGuests[]> {
    const firstKey = monthsEndingAt(lastKey, count)[0];
    const rows = await this.dataSource.query<
      { month: string; guests: number; check_ins: number }[]
    >(
      `/* summary:monthly */
       WITH "months" AS (
         SELECT generate_series($2::date, $3::date, interval '1 month')::date AS "month"
       ), "totals" AS (
         SELECT date_trunc('month', ci."checked_in_at" AT TIME ZONE '${REPORT_TIMEZONE}')::date AS "month",
                COUNT(*)::int AS "check_ins",
                SUM(r."party_size")::int AS "guests"
         FROM "check_ins" ci
         JOIN "reservations" r ON r."id" = ci."reservation_id"
         WHERE ci."restaurant_id" = $1 AND ci."checked_in_at" >= $4 AND ci."checked_in_at" < $5
         GROUP BY 1
       )
       SELECT to_char(m."month", 'YYYY-MM') AS "month",
              COALESCE(t."guests", 0)::int AS "guests",
              COALESCE(t."check_ins", 0)::int AS "check_ins"
       FROM "months" m
       LEFT JOIN "totals" t ON t."month" = m."month"
       ORDER BY m."month"`,
      [
        restaurantId,
        `${firstKey}-01`,
        `${lastKey}-01`,
        monthStartInstant(firstKey),
        monthStartInstant(shiftMonth(lastKey, 1)),
      ],
    );
    return rows.map((row) => ({
      month: row.month,
      guests: row.guests,
      checkIns: row.check_ins,
    }));
  }
}
