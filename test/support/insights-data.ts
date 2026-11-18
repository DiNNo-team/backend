import type { RestaurantMetrics } from '../../src/modules/reservations-checkin/index.js';
import type { InsightsActivity } from '../../src/modules/insights/metrics/insights-activity.reader.js';
import type {
  DailyActivity,
  InsightsMetrics,
  PreviousMetrics,
} from '../../src/modules/insights/metrics/insights-metrics.js';

// Datos de prueba del informe de IA (unitarias y e2e). Los días son la semana
// del miércoles 2026-11-11 al martes 2026-11-17 de Bogotá.
export const INSIGHTS_DAYS = [
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-14',
  '2026-11-15',
  '2026-11-16',
  '2026-11-17',
];

// Lo que devuelve RestaurantMetricsService.forRestaurant.
export function summaryWith(
  counts: Partial<RestaurantMetrics['reservations']> = {},
  extra: Partial<Omit<RestaurantMetrics, 'reservations'>> = {},
): RestaurantMetrics {
  return {
    billing: { checkIns: counts.completed ?? 0, amountCop: 0 },
    reservations: {
      created: 0,
      completed: 0,
      cancelled: 0,
      expired: 0,
      active: 0,
      ...counts,
    },
    rates: { conversion: null, noShow: null, cancellation: null },
    averagePartySize: null,
    peakHours: [],
    byDayOfWeek: [],
    ...extra,
  };
}

export function emptyActivity(): InsightsActivity {
  return {
    daily: [],
    topSlots: [],
    medianMinutesToCheckIn: null,
    manualUpdatesByDay: [],
  };
}

function daily(manualUpdates: number[]): DailyActivity[] {
  return INSIGHTS_DAYS.map((date, index) => ({
    date,
    created: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    manualUpdates: manualUpdates[index] ?? 0,
  }));
}

// Métricas con datos suficientes: 40 resueltas, 65 % de check-in. Cada prueba
// cambia lo que necesita.
export function enoughMetrics(
  overrides: Partial<InsightsMetrics> = {},
  manualUpdates: number[] = [3, 4, 0, 5, 2, 6, 4],
): InsightsMetrics {
  const days = daily(manualUpdates);
  const total = manualUpdates.reduce((sum, value) => sum + value, 0);
  const withUpdates = manualUpdates.filter((value) => value > 0).length;
  return {
    reservationsCreated: 42,
    active: 2,
    resolved: 40,
    completed: 26,
    cancelled: 4,
    expired: 10,
    checkIns: 26,
    checkInRate: 0.65,
    noShowRate: 0.25,
    cancellationRate: 0.1,
    medianMinutesToCheckIn: 9.5,
    averagePartySize: 2.8,
    topSlots: [
      { dayOfWeek: 5, hour: 13, reservations: 6 },
      { dayOfWeek: 6, hour: 20, reservations: 5 },
    ],
    daily: days,
    manualUpdates: total,
    manualUpdatesPerDay: Math.round((total / days.length) * 10) / 10,
    daysWithManualUpdates: withUpdates,
    daysWithoutManualUpdates: days.length - withUpdates,
    ...overrides,
  };
}

export function insufficientMetrics(
  overrides: Partial<InsightsMetrics> = {},
): InsightsMetrics {
  return enoughMetrics({
    reservationsCreated: 5,
    active: 1,
    resolved: 4,
    completed: 3,
    cancelled: 1,
    expired: 0,
    checkIns: 3,
    checkInRate: null,
    noShowRate: null,
    cancellationRate: null,
    topSlots: [{ dayOfWeek: 2, hour: 12, reservations: 2 }],
    ...overrides,
  });
}

// La semana anterior a enoughMetrics: menos reservas y menos check-in.
export function previousMetrics(
  overrides: Partial<PreviousMetrics> = {},
): PreviousMetrics {
  return {
    reservationsCreated: 35,
    resolved: 33,
    checkInRate: 0.55,
    ...overrides,
  };
}
