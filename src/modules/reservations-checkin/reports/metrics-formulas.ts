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

// Las 24 horas (0 a 23, Bogotá), en orden, con 0 en las horas sin reservas. Es
// la distribución completa del panel del administrador; el resumen del
// restaurante sigue mostrando solo las 3 horas pico.
export function hourlyDistribution(counts: HourCount[]): HourCount[] {
  const byHour = new Map(counts.map((count) => [count.hour, count]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    reservations: byHour.get(hour)?.reservations ?? 0,
  }));
}

export interface DateCount {
  date: string;
  reservations: number;
}

export interface DayHourCount {
  dayOfWeek: number;
  hour: number;
  reservations: number;
}

// Siempre 168 entradas (7 días × 24 horas), de lunes (1) a domingo (7) y de la
// hora 0 a la 23 dentro de cada día, con 0 donde no hay reservas. Es el mapa de
// calor del panel del administrador; suma lo mismo que las horas y los días.
export function dayHourDistribution(counts: DayHourCount[]): DayHourCount[] {
  const byCell = new Map(
    counts.map((count) => [`${count.dayOfWeek}-${count.hour}`, count]),
  );
  return [1, 2, 3, 4, 5, 6, 7].flatMap((dayOfWeek) =>
    Array.from({ length: 24 }, (_, hour) => ({
      dayOfWeek,
      hour,
      reservations: byCell.get(`${dayOfWeek}-${hour}`)?.reservations ?? 0,
    })),
  );
}
