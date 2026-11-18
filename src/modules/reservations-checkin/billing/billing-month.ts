import {
  bogotaDay,
  parseReportPeriod,
  type ReportPeriod,
} from '../reports/report-period.js';

// Mes de cobro del panel del administrador (Sprint 4): un mes de calendario en
// Bogotá, escrito AAAA-MM. Función pura, sin Nest ni base. El periodo se arma con
// parseReportPeriod, así el mes usa la misma regla de días e instantes UTC que
// el estado de cuenta y el resumen del restaurante.

// El primer mes con cobro: antes de 2026 no hubo check-ins.
export const MIN_BILLING_MONTH = '2026-01';

export const BILLING_MONTH_MESSAGES = {
  INVALID:
    'El mes (month) debe tener el formato AAAA-MM y ser un mes real, por ejemplo 2026-11.',
  BEFORE_MIN: `El mes (month) no puede ser anterior a ${MIN_BILLING_MONTH}.`,
  IN_FUTURE: 'El mes (month) no puede ser posterior al mes en curso.',
} as const;

const MONTH_FORMAT = /^(\d{4})-(\d{2})$/;

export interface BillingMonth {
  // AAAA-MM
  key: string;
  // AAAA-MM-01, el valor de billing_periods.period_month.
  firstDay: string;
  // true si el mes ya terminó en Bogotá: solo un mes cerrado se puede marcar.
  closed: boolean;
  // El mes completo, o hasta hoy si está en curso (días de Bogotá).
  period: ReportPeriod;
}

export type BillingMonthResult =
  { ok: true; month: BillingMonth } | { ok: false; errors: string[] };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// El mes de Bogotá de un instante, como AAAA-MM.
export function bogotaMonthKey(now: Date): string {
  const today = new Date(bogotaDay(now));
  return `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}`;
}

// Suma (o resta) meses a un AAAA-MM válido.
export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

// Medianoche de Bogotá del día 1 de un AAAA-MM, como instante UTC. Bogotá es
// siempre UTC-5 (lo fija report-period.spec.ts).
export function monthStartInstant(key: string): Date {
  return new Date(`${key}-01T05:00:00.000Z`);
}

// Los `count` meses que terminan en `key`, del más antiguo al más reciente.
export function monthsEndingAt(key: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    shiftMonth(key, index - count + 1),
  );
}

function lastDayOf(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${key}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

function isRealMonth(text: string): boolean {
  const match = MONTH_FORMAT.exec(text);
  if (!match) {
    return false;
  }
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

// Valida y resuelve el mes. Sin mes: el mes en curso. Los AAAA-MM se comparan
// como texto: con el formato ya validado, el orden del texto es el del tiempo.
export function parseBillingMonth(
  text: string | undefined,
  now: Date,
): BillingMonthResult {
  const current = bogotaMonthKey(now);
  const key = text ?? current;
  if (!isRealMonth(key)) {
    return { ok: false, errors: [BILLING_MONTH_MESSAGES.INVALID] };
  }
  if (key < MIN_BILLING_MONTH) {
    return { ok: false, errors: [BILLING_MONTH_MESSAGES.BEFORE_MIN] };
  }
  if (key > current) {
    return { ok: false, errors: [BILLING_MONTH_MESSAGES.IN_FUTURE] };
  }
  const closed = key < current;
  const result = parseReportPeriod(
    { from: `${key}-01`, ...(closed ? { to: lastDayOf(key) } : {}) },
    now,
  );
  if (!result.ok) {
    // Imposible con un mes válido que no es futuro: el periodo cabe siempre.
    throw new Error(`Periodo inválido para el mes ${key}`);
  }
  return {
    ok: true,
    month: { key, firstDay: `${key}-01`, closed, period: result.period },
  };
}
