import { parseReportPeriod, type ReportPeriod } from './report-period.js';

// El periodo con el que se compara el resumen del restaurante (CLAUDE.md §11,
// "Resumen de la pantalla del restaurante"). Función pura, sin Nest ni base.
//
// - Si el periodo empieza el día 1 de un mes y no sale de ese mes, es el MISMO
//   TRAMO del mes anterior: del día 1 al mismo día, recortado al último día de
//   ese mes (1–17 nov → 1–17 oct; 1–31 mar → 1–28 feb o 1–29 feb en bisiesto).
//   Si el periodo llega al último día de su mes, el anterior también (1–30 nov →
//   1–31 oct): es el mes completo contra el mes completo.
// - En cualquier otro caso, los mismos N días inmediatamente anteriores
//   (3–10 nov → 26 oct–2 nov).
const DAY_MS = 24 * 60 * 60 * 1000;

function parts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year, month, date];
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function previousComparablePeriod(
  period: Pick<ReportPeriod, 'from' | 'to'>,
  now: Date,
): ReportPeriod {
  const [fromYear, fromMonth, fromDay] = parts(period.from);
  const [toYear, toMonth, toDay] = parts(period.to);
  let from: string;
  let to: string;
  if (fromDay === 1 && fromYear === toYear && fromMonth === toMonth) {
    const previousFirst = Date.UTC(fromYear, fromMonth - 2, 1);
    const previous = new Date(previousFirst);
    const previousLast = daysInMonth(
      previous.getUTCFullYear(),
      previous.getUTCMonth() + 1,
    );
    const endsMonth = toDay === daysInMonth(toYear, toMonth);
    const day = endsMonth ? previousLast : Math.min(toDay, previousLast);
    from = format(previousFirst);
    to = format(previousFirst + (day - 1) * DAY_MS);
  } else {
    const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);
    const toMs = Date.UTC(toYear, toMonth - 1, toDay);
    const length = (toMs - fromMs) / DAY_MS + 1;
    const previousTo = fromMs - DAY_MS;
    to = format(previousTo);
    from = format(previousTo - (length - 1) * DAY_MS);
  }
  const result = parseReportPeriod({ from, to }, now);
  if (!result.ok) {
    // Imposible con un periodo válido: el anterior es más corto o igual y está
    // en el pasado.
    throw new Error(`Periodo anterior inválido: ${from}..${to}`);
  }
  return result.period;
}
