import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  REPORT_TIMEZONE,
  type ReportPeriod,
} from '../../reservations-checkin/index.js';
import { TOP_SLOTS_LIMIT } from '../insights.constants.js';

// Reservas creadas un día de Bogotá, por su estado actual.
export interface DailyReservationsRow {
  date: string;
  created: number;
  completed: number;
  cancelled: number;
  expired: number;
}

export interface TopSlotRow {
  dayOfWeek: number;
  hour: number;
  reservations: number;
}

export interface ManualUpdatesRow {
  date: string;
  updates: number;
}

export interface InsightsActivity {
  daily: DailyReservationsRow[];
  topSlots: TopSlotRow[];
  medianMinutesToCheckIn: number | null;
  manualUpdatesByDay: ManualUpdatesRow[];
}

const BOGOTA_DATE = (column: string) =>
  `to_char((${column} AT TIME ZONE '${REPORT_TIMEZONE}')::date, 'YYYY-MM-DD')`;

// Lo que el informe necesita y RestaurantMetricsService no calcula: la serie
// por día, las franjas (día y hora) con más reservas, la mediana hasta el
// check-in y los cambios manuales de mesas.
//
// Solo lectura y siempre filtrado por el restaurante de la sesión. Lee
// reservations (de reservations-checkin) y table_logs + tables (de
// restaurant-operations) con SQL directo, como el modelo de lectura de la
// opción (a) de docs/ia-diseno.md §6.1: nunca escribe en esas tablas. Cuatro
// consultas en paralelo que devuelven agregados, no filas; los rangos usan los
// instantes UTC del periodo, así aprovechan los índices por fecha.
@Injectable()
export class InsightsActivityReader {
  constructor(private readonly dataSource: DataSource) {}

  async forRestaurant(
    restaurantId: string,
    period: ReportPeriod,
  ): Promise<InsightsActivity> {
    const range = [restaurantId, period.startsAt, period.endsBefore];
    const [daily, topSlots, median, manual] = await Promise.all([
      this.dataSource.query<DailyReservationsRow[]>(
        `SELECT ${BOGOTA_DATE('"created_at"')} AS "date",
                COUNT(*)::int AS "created",
                COUNT(*) FILTER (WHERE "status" = 'completed')::int AS "completed",
                COUNT(*) FILTER (WHERE "status" = 'cancelled')::int AS "cancelled",
                COUNT(*) FILTER (WHERE "status" = 'expired')::int AS "expired"
         FROM "reservations"
         WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3
         GROUP BY 1`,
        range,
      ),
      this.dataSource.query<TopSlotRow[]>(
        `SELECT EXTRACT(ISODOW FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "dayOfWeek",
                EXTRACT(HOUR FROM "created_at" AT TIME ZONE '${REPORT_TIMEZONE}')::int AS "hour",
                COUNT(*)::int AS "reservations"
         FROM "reservations"
         WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3
         GROUP BY 1, 2
         ORDER BY 3 DESC, 1, 2
         LIMIT ${TOP_SLOTS_LIMIT}`,
        range,
      ),
      this.dataSource.query<{ median: number | null }[]>(
        `SELECT percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY EXTRACT(EPOCH FROM ("checked_in_at" - "created_at")) / 60
                )::float8 AS "median"
         FROM "reservations"
         WHERE "restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3
           AND "status" = 'completed' AND "checked_in_at" IS NOT NULL`,
        range,
      ),
      this.dataSource.query<ManualUpdatesRow[]>(
        `SELECT ${BOGOTA_DATE('l."changed_at"')} AS "date", COUNT(*)::int AS "updates"
         FROM "table_logs" l
         JOIN "tables" t ON t."id" = l."table_id"
         WHERE t."restaurant_id" = $1 AND l."source" = 'manual'
           AND l."changed_at" >= $2 AND l."changed_at" < $3
         GROUP BY 1`,
        range,
      ),
    ]);
    return {
      daily,
      topSlots,
      medianMinutesToCheckIn: median[0]?.median ?? null,
      manualUpdatesByDay: manual,
    };
  }
}
