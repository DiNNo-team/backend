// Periodo de los reportes del restaurante (estado de cuenta y resumen; CLAUDE.md
// §11, "Cobro por check-in" y "Resumen y KPIs"). Función pura, sin Nest ni base:
// la reutilizan el estado de cuenta, el resumen y el informe de IA del Sprint 4.
//
// Las fechas son días de calendario en Bogotá (YYYY-MM-DD) y el rango es
// inclusivo: from 00:00 hasta el final de to. Para consultar se convierte a
// instantes UTC [startsAt, endsBefore), así el filtro usa los índices sobre las
// columnas timestamptz (no se aplica una función a la columna).

export const REPORT_TIMEZONE = 'America/Bogota';
export const REPORT_MAX_DAYS = 366;

// Bogotá no tiene horario de verano desde 1993: siempre UTC-5. Lo fija
// report-period.spec.ts comparándolo con Intl.
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

export const REPORT_PERIOD_MESSAGES = {
  FROM_INVALID:
    'La fecha inicial (from) debe tener el formato AAAA-MM-DD y ser una fecha real, por ejemplo 2026-11-01.',
  TO_INVALID:
    'La fecha final (to) debe tener el formato AAAA-MM-DD y ser una fecha real, por ejemplo 2026-11-30.',
  FROM_AFTER_TO:
    'La fecha inicial (from) no puede ser posterior a la fecha final (to).',
  TO_IN_FUTURE: 'La fecha final (to) no puede ser posterior a hoy.',
  TOO_LONG: `El rango puede tener como máximo ${REPORT_MAX_DAYS} días. Elige un periodo más corto.`,
} as const;

export interface ReportPeriodQuery {
  from?: string;
  to?: string;
}

export interface ReportPeriod {
  // Días de Bogotá, tal como se pidieron (o los valores por defecto).
  from: string;
  to: string;
  timezone: typeof REPORT_TIMEZONE;
  // Instantes UTC: [startsAt, endsBefore).
  startsAt: Date;
  endsBefore: Date;
}

export type ReportPeriodResult =
  { ok: true; period: ReportPeriod } | { ok: false; errors: string[] };

// Día de calendario a milisegundos UTC de su medianoche UTC; null si no es una
// fecha real (2026-02-30, 2026-13-01).
function parseDay(text: string): number | null {
  const match = DATE_FORMAT.exec(text);
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? ms
    : null;
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// El día de Bogotá de un instante, como medianoche UTC de ese día.
export function bogotaDay(instant: Date): number {
  const shifted = instant.getTime() - BOGOTA_UTC_OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS);
}

function firstOfMonth(dayMs: number): number {
  const date = new Date(dayMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

// Valida y resuelve el periodo. Por defecto: del día 1 del mes de to hasta hoy
// (sin parámetros, el mes en curso hasta hoy). Errores en español, uno por
// problema; si el formato falla, no se revisa lo demás.
export function parseReportPeriod(
  query: ReportPeriodQuery,
  now: Date,
): ReportPeriodResult {
  const today = bogotaDay(now);
  const to = query.to === undefined ? today : parseDay(query.to);
  const fromInput = query.from === undefined ? undefined : parseDay(query.from);

  const formatErrors: string[] = [];
  if (fromInput === null) {
    formatErrors.push(REPORT_PERIOD_MESSAGES.FROM_INVALID);
  }
  if (to === null) {
    formatErrors.push(REPORT_PERIOD_MESSAGES.TO_INVALID);
  }
  if (formatErrors.length > 0 || to === null || fromInput === null) {
    return { ok: false, errors: formatErrors };
  }

  const from = fromInput ?? firstOfMonth(to);
  const errors: string[] = [];
  if (to > today) {
    errors.push(REPORT_PERIOD_MESSAGES.TO_IN_FUTURE);
  }
  if (from > to) {
    errors.push(REPORT_PERIOD_MESSAGES.FROM_AFTER_TO);
  } else if ((to - from) / DAY_MS + 1 > REPORT_MAX_DAYS) {
    errors.push(REPORT_PERIOD_MESSAGES.TOO_LONG);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    period: {
      from: formatDay(from),
      to: formatDay(to),
      timezone: REPORT_TIMEZONE,
      startsAt: new Date(from + BOGOTA_UTC_OFFSET_MS),
      endsBefore: new Date(to + DAY_MS + BOGOTA_UTC_OFFSET_MS),
    },
  };
}
