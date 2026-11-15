import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BillingStatementService,
  type CheckInTotals,
} from '../billing/billing-statement.service.js';
import {
  byDayOfWeek,
  peakHours,
  reservationRates,
  roundAverage,
  type DayOfWeekCount,
  type HourCount,
  type ReservationCounts,
  type ReservationRates,
} from './metrics-formulas.js';
import { REPORT_TIMEZONE, type ReportPeriod } from './report-period.js';

// Los números del resumen de un restaurante en un periodo, sin nada de HTTP: los
// usa GET /v1/restaurants/me/summary y los reutilizará el informe de IA del
// Sprint 4 (exportado por reservations-checkin/index.ts).
export interface RestaurantMetrics {
  billing: CheckInTotals;
  reservations: ReservationCounts;
  rates: ReservationRates;
  averagePartySize: number | null;
  peakHours: HourCount[];
  byDayOfWeek: DayOfWeekCount[];
}

interface ReservationCountsRow {
  created: number;
  completed: number;
  cancelled: number;
  expired: number;
  active: number;
  average_party_size: number | null;
}

// Agregaciones en SQL (CLAUDE.md §11, "Resumen y KPIs"), cuatro consultas en
// paralelo (la de los check-ins es la del estado de cuenta) y sin traer filas a memoria: Postgres devuelve conteos, como mucho 24
// filas por hora y 7 por día. Los rangos usan los instantes UTC del periodo
// ([startsAt, endsBefore)), así cada consulta usa su índice
// (IDX_reservations_restaurant_id_created_at y
// IDX_check_ins_restaurant_id_checked_in_at); la hora y el día de la semana se
// calculan en Bogotá con AT TIME ZONE.
//
// No vence nada: quien la llama decide (el resumen vence antes las reservas
// debidas del restaurante para que nada vencido cuente como activo).
@Injectable()
export class RestaurantMetricsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly billing: BillingStatementService,
  ) {}

  async forRestaurant(
    restaurantId: string,
    period: ReportPeriod,
  ): Promise<RestaurantMetrics> {
    const range = [restaurantId, period.startsAt, period.endsBefore];
    const [counts, hours, days, billing] = await Promise.all([
      this.reservationCounts(range),
      this.dataSource.query<HourCount[]>(
        `SELECT EXTRACT(HOUR FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "hour", COUNT(*)::int AS "reservations"
         FROM "reservations"
         WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3
         GROUP BY 1`,
        range,
      ),
      this.dataSource.query<DayOfWeekCount[]>(
        `SELECT EXTRACT(ISODOW FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "dayOfWeek", COUNT(*)::int AS "reservations"
         FROM "reservations"
         WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3
         GROUP BY 1`,
        range,
      ),
      // Los mismos totales del estado de cuenta: una sola regla de cobro.
      this.billing.totals(restaurantId, period),
    ]);
    const { average_party_size: average, ...reservations } = counts;
    return {
      billing,
      reservations,
      rates: reservationRates(reservations),
      averagePartySize: roundAverage(average),
      peakHours: peakHours(hours),
      byDayOfWeek: byDayOfWeek(days),
    };
  }

  // Reservas creadas en el periodo, por estado actual, y el promedio de personas.
  private async reservationCounts(
    range: unknown[],
  ): Promise<ReservationCountsRow> {
    const [row] = await this.dataSource.query<ReservationCountsRow[]>(
      `SELECT COUNT(*)::int AS "created",
              COUNT(*) FILTER (WHERE "status" = 'completed')::int AS "completed",
              COUNT(*) FILTER (WHERE "status" = 'cancelled')::int AS "cancelled",
              COUNT(*) FILTER (WHERE "status" = 'expired')::int AS "expired",
              COUNT(*) FILTER (WHERE "status" = 'active')::int AS "active",
              AVG("party_size")::float8 AS "average_party_size"
       FROM "reservations"
       WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3`,
      range,
    );
    return row;
  }
}
