import type { RestaurantMetrics } from '../../reservations-checkin/index.js';
import { INSIGHTS_MIN_RESOLVED } from '../insights.constants.js';
import type { InsightsActivity } from './insights-activity.reader.js';

export type DataSufficiency = 'enough' | 'insufficient';

export interface DailyActivity {
  // Día de Bogotá (AAAA-MM-DD).
  date: string;
  created: number;
  completed: number;
  cancelled: number;
  expired: number;
  manualUpdates: number;
}

export interface TopSlot {
  dayOfWeek: number;
  hour: number;
  reservations: number;
}

export interface InsightsMetrics {
  reservationsCreated: number;
  active: number;
  // Las que ya terminaron: completed + cancelled + expired.
  resolved: number;
  completed: number;
  cancelled: number;
  expired: number;
  // Check-ins hechos en el periodo (los mismos del estado de cuenta).
  checkIns: number;
  // Sobre las resueltas; null con datos insuficientes.
  checkInRate: number | null;
  noShowRate: number | null;
  cancellationRate: number | null;
  medianMinutesToCheckIn: number | null;
  averagePartySize: number | null;
  topSlots: TopSlot[];
  // Siempre un elemento por día del periodo, del más antiguo al de hoy.
  daily: DailyActivity[];
  manualUpdates: number;
  manualUpdatesPerDay: number;
  daysWithManualUpdates: number;
  daysWithoutManualUpdates: number;
}

export interface PreviousMetrics {
  reservationsCreated: number;
  resolved: number;
  checkInRate: number | null;
}

// Tasa con 4 decimales, como el resumen del restaurante.
function rate(part: number, total: number): number {
  return Math.round((part / total) * 10_000) / 10_000;
}

function resolvedOf(counts: RestaurantMetrics['reservations']): number {
  return counts.completed + counts.cancelled + counts.expired;
}

export function dataSufficiency(resolved: number): DataSufficiency {
  return resolved >= INSIGHTS_MIN_RESOLVED ? 'enough' : 'insufficient';
}

// Une los conteos del resumen (RestaurantMetricsService) con la actividad del
// informe (InsightsActivityReader). Función pura: la prueban sin base.
export function buildInsightsMetrics(
  summary: RestaurantMetrics,
  activity: InsightsActivity,
  days: string[],
): InsightsMetrics {
  const counts = summary.reservations;
  const resolved = resolvedOf(counts);
  const enough = dataSufficiency(resolved) === 'enough';

  const dailyByDate = new Map(activity.daily.map((row) => [row.date, row]));
  const manualByDate = new Map(
    activity.manualUpdatesByDay.map((row) => [row.date, row.updates]),
  );
  const daily = days.map((date) => {
    const row = dailyByDate.get(date);
    return {
      date,
      created: row?.created ?? 0,
      completed: row?.completed ?? 0,
      cancelled: row?.cancelled ?? 0,
      expired: row?.expired ?? 0,
      manualUpdates: manualByDate.get(date) ?? 0,
    };
  });
  const manualUpdates = daily.reduce((sum, day) => sum + day.manualUpdates, 0);
  const daysWithManualUpdates = daily.filter(
    (day) => day.manualUpdates > 0,
  ).length;

  return {
    reservationsCreated: counts.created,
    active: counts.active,
    resolved,
    completed: counts.completed,
    cancelled: counts.cancelled,
    expired: counts.expired,
    checkIns: summary.billing.checkIns,
    checkInRate: enough ? rate(counts.completed, resolved) : null,
    noShowRate: enough ? rate(counts.expired, resolved) : null,
    cancellationRate: enough ? rate(counts.cancelled, resolved) : null,
    medianMinutesToCheckIn:
      activity.medianMinutesToCheckIn === null
        ? null
        : Math.round(activity.medianMinutesToCheckIn * 10) / 10,
    averagePartySize: summary.averagePartySize,
    topSlots: activity.topSlots,
    daily,
    manualUpdates,
    manualUpdatesPerDay: Math.round((manualUpdates / days.length) * 10) / 10,
    daysWithManualUpdates,
    daysWithoutManualUpdates: days.length - daysWithManualUpdates,
  };
}

// Lo justo para comparar con la semana anterior. La tasa sigue la misma regla
// de datos suficientes: con pocas resueltas no se compara una tasa.
export function buildPreviousMetrics(
  summary: RestaurantMetrics,
): PreviousMetrics {
  const counts = summary.reservations;
  const resolved = resolvedOf(counts);
  return {
    reservationsCreated: counts.created,
    resolved,
    checkInRate:
      dataSufficiency(resolved) === 'enough'
        ? rate(counts.completed, resolved)
        : null,
  };
}
