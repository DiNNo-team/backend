import {
  parseReportPeriod,
  REPORT_TIMEZONE,
  type ReportPeriod,
} from '../../reservations-checkin/index.js';
import { INSIGHTS_PERIOD_DAYS } from '../insights.constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InsightsPeriods {
  // Los últimos 7 días de Bogotá, hoy incluido.
  current: ReportPeriod;
  // Los 7 días anteriores, para comparar.
  previous: ReportPeriod;
}

// El día de hoy en Bogotá (AAAA-MM-DD), con Intl: no depende del TZ del
// servidor. en-CA formatea las fechas como AAAA-MM-DD.
function bogotaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// Los dos periodos del informe, resueltos con la misma función de los reportes
// del restaurante (parseReportPeriod: días de Bogotá a instantes UTC).
export function insightsPeriods(now: Date): InsightsPeriods {
  const today = bogotaToday(now);
  const currentFrom = shiftDays(today, -(INSIGHTS_PERIOD_DAYS - 1));
  return {
    current: resolve(currentFrom, today, now),
    previous: resolve(
      shiftDays(currentFrom, -INSIGHTS_PERIOD_DAYS),
      shiftDays(currentFrom, -1),
      now,
    ),
  };
}

// Los días del periodo, del primero al último (AAAA-MM-DD).
export function periodDays(period: ReportPeriod): string[] {
  const days: string[] = [];
  for (let day = period.from; day <= period.to; day = shiftDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function resolve(from: string, to: string, now: Date): ReportPeriod {
  const result = parseReportPeriod({ from, to }, now);
  if (!result.ok) {
    // No pasa: las fechas salen de hoy y nunca son futuras ni pasan de 366 días.
    throw new Error(`Periodo del informe inválido: ${result.errors.join(' ')}`);
  }
  return result.period;
}
