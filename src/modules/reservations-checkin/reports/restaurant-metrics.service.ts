import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  BillingStatementService,
  type CheckInTotals,
} from '../billing/billing-statement.service.js';
import {
  byDayOfWeek,
  dayHourDistribution,
  hourlyDistribution,
  peakHours,
  reservationRates,
  roundAverage,
  type DateCount,
  type DayHourCount,
  type DayOfWeekCount,
  type HourCount,
  type ReservationCounts,
  type ReservationRates,
} from './metrics-formulas.js';
import { REPORT_TIMEZONE, type ReportPeriod } from './report-period.js';
import { scopedRange } from './scoped-range.js';

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

// Los mismos números de toda la plataforma (panel del administrador): las
// mismas consultas y fórmulas, sin el filtro de restaurante. En vez de las 3
// horas pico trae la distribución de las 24 horas.
export interface PlatformMetrics {
  billing: CheckInTotals;
  reservations: ReservationCounts;
  rates: ReservationRates;
  averagePartySize: number | null;
  hourly: HourCount[];
  byDayOfWeek: DayOfWeekCount[];
  // Reservas creadas por cada día del periodo (también los días en 0) y por
  // día de la semana y hora (siempre 168 celdas), en hora de Bogotá.
  byDate: DateCount[];
  byDayHour: DayHourCount[];
}

interface ReservationCountsRow {
  created: number;
  completed: number;
  cancelled: number;
  expired: number;
  active: number;
  average_party_size: number | null;
}

interface RawMetrics {
  billing: CheckInTotals;
  reservations: ReservationCounts;
  rates: ReservationRates;
  averagePartySize: number | null;
  hours: HourCount[];
  byDayOfWeek: DayOfWeekCount[];
}

// Agregaciones en SQL (CLAUDE.md §11, "Resumen y KPIs"), cuatro consultas en
// paralelo (la de los check-ins es la del estado de cuenta) y sin traer filas a
// memoria: Postgres devuelve conteos, como mucho 24 filas por hora y 7 por día.
// Los rangos usan los instantes UTC del periodo ([startsAt, endsBefore)), así
// cada consulta usa su índice: con restaurante,
// IDX_reservations_restaurant_id_created_at e
// IDX_check_ins_restaurant_id_checked_in_at; sin restaurante (la plataforma),
// IDX_reservations_created_at e IDX_check_ins_checked_in_at. La hora y el día de
// la semana se calculan en Bogotá con AT TIME ZONE. El WHERE sale de
// scopedRange: la consulta del restaurante es la de siempre.
//
// No vence nada: quien la llama decide (el resumen vence antes las reservas
// debidas del restaurante; la plataforma, todas las debidas).
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
    const { hours, ...metrics } = await this.compute(period, restaurantId);
    return { ...metrics, peakHours: peakHours(hours) };
  }

  // Las mismas consultas del restaurante sin su filtro, más los dos desgloses
  // del panel. Todas cuentan las MISMAS reservas (el mismo WHERE de scopedRange),
  // así que la suma de byDate y la de byDayHour son reservations.created.
  async forPlatform(period: ReportPeriod): Promise<PlatformMetrics> {
    const [{ hours, ...metrics }, byDate, dayHours] = await Promise.all([
      this.compute(period),
      this.reservationsByDate(period),
      this.reservationsByDayHour(period),
    ]);
    return {
      ...metrics,
      hourly: hourlyDistribution(hours),
      byDate,
      byDayHour: dayHourDistribution(dayHours),
    };
  }

  // Una entrada por CADA día del periodo (generate_series), con 0 en los días sin
  // reservas. El día es el de Bogotá: created_at AT TIME ZONE 'America/Bogota'
  // pasa a hora local y ::date toma su día. $3 y $4 son los días from y to del
  // periodo (ya validados por parseReportPeriod).
  private async reservationsByDate(period: ReportPeriod): Promise<DateCount[]> {
    const range = scopedRange('created_at', period);
    return this.dataSource.query<DateCount[]>(
      `SELECT to_char(d."day", 'YYYY-MM-DD') AS "date", COALESCE(r."reservations", 0)::int AS "reservations"
       FROM generate_series($3::date, $4::date, interval '1 day') AS d("day")
       LEFT JOIN (
         SELECT ("created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::date AS "day", COUNT(*)::int AS "reservations"
         FROM "reservations"
         WHERE ${range.where}
         GROUP BY 1
       ) r ON r."day" = d."day"::date
       ORDER BY d."day"`,
      [...range.params, period.from, period.to],
    );
  }

  private reservationsByDayHour(period: ReportPeriod): Promise<DayHourCount[]> {
    const range = scopedRange('created_at', period);
    return this.dataSource.query<DayHourCount[]>(
      `SELECT EXTRACT(ISODOW FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "dayOfWeek",
              EXTRACT(HOUR FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "hour",
              COUNT(*)::int AS "reservations"
       FROM "reservations"
       WHERE ${range.where}
       GROUP BY 1, 2`,
      range.params,
    );
  }

  private async compute(
    period: ReportPeriod,
    restaurantId?: string,
  ): Promise<RawMetrics> {
    const range = scopedRange('created_at', period, restaurantId);
    const [counts, hours, days, billing] = await Promise.all([
      this.reservationCounts(range.where, range.params),
      this.dataSource.query<HourCount[]>(
        `SELECT EXTRACT(HOUR FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "hour", COUNT(*)::int AS "reservations"
         FROM "reservations"
         WHERE ${range.where}
         GROUP BY 1`,
        range.params,
      ),
      this.dataSource.query<DayOfWeekCount[]>(
        `SELECT EXTRACT(ISODOW FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "dayOfWeek", COUNT(*)::int AS "reservations"
         FROM "reservations"
         WHERE ${range.where}
         GROUP BY 1`,
        range.params,
      ),
      // Los mismos totales del estado de cuenta: una sola regla de cobro.
      restaurantId === undefined
        ? this.billing.platformTotals(period)
        : this.billing.totals(restaurantId, period),
    ]);
    const { average_party_size: average, ...reservations } = counts;
    return {
      billing,
      reservations,
      rates: reservationRates(reservations),
      averagePartySize: roundAverage(average),
      hours,
      byDayOfWeek: byDayOfWeek(days),
    };
  }

  // Reservas creadas en el periodo, por estado actual, y el promedio de personas.
  private async reservationCounts(
    where: string,
    params: unknown[],
  ): Promise<ReservationCountsRow> {
    const [row] = await this.dataSource.query<ReservationCountsRow[]>(
      `SELECT COUNT(*)::int AS "created",
              COUNT(*) FILTER (WHERE "status" = 'completed')::int AS "completed",
              COUNT(*) FILTER (WHERE "status" = 'cancelled')::int AS "cancelled",
              COUNT(*) FILTER (WHERE "status" = 'expired')::int AS "expired",
              COUNT(*) FILTER (WHERE "status" = 'active')::int AS "active",
              AVG("party_size")::float8 AS "average_party_size"
       FROM "reservations"
       WHERE ${where}`,
      params,
    );
    return row;
  }
}
