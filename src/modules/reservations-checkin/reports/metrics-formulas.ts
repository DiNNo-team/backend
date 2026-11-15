// Fórmulas del resumen del restaurante (CLAUDE.md §11, "Resumen y KPIs").
// Funciones puras: las consultas SQL traen solo conteos y estas los convierten
// en tasas y listas. Las reutiliza el informe de IA del Sprint 4.

export interface ReservationCounts {
  created: number;
  completed: number;
  cancelled: number;
  expired: number;
  active: number;
}

export interface ReservationRates {
  // completed / created
  conversion: number | null;
  // expired / (completed + expired): de las que terminaron por llegar o no.
  noShow: number | null;
  // cancelled / created
  cancellation: number | null;
}

export interface HourCount {
  hour: number;
  reservations: number;
}

export interface DayOfWeekCount {
  dayOfWeek: number;
  reservations: number;
}

export const PEAK_HOURS_LIMIT = 3;

// Una tasa con 4 decimales; null si el denominador es 0 (no hay de dónde medir).
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function reservationRates(counts: ReservationCounts): ReservationRates {
  return {
    conversion: ratio(counts.completed, counts.created),
    noShow: ratio(counts.expired, counts.completed + counts.expired),
    cancellation: ratio(counts.cancelled, counts.created),
  };
}

// Promedio de personas con 2 decimales; null sin reservas.
export function roundAverage(average: number | null): number | null {
  return average === null ? null : Math.round(average * 100) / 100;
}

// Las 3 horas (0 a 23, Bogotá) con más reservas creadas; desempate por hora
// menor. Las horas sin reservas no cuentan: sin datos, la lista va vacía.
export function peakHours(counts: HourCount[]): HourCount[] {
  return counts
    .filter((count) => count.reservations > 0)
    .sort((a, b) => b.reservations - a.reservations || a.hour - b.hour)
    .slice(0, PEAK_HOURS_LIMIT);
}

// Siempre 7 entradas, de lunes (1) a domingo (7), con 0 en los días sin datos.
export function byDayOfWeek(counts: DayOfWeekCount[]): DayOfWeekCount[] {
  const byDay = new Map(counts.map((count) => [count.dayOfWeek, count]));
  return [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    reservations: byDay.get(dayOfWeek)?.reservations ?? 0,
  }));
}
