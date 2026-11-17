import {
  DAY_NAMES,
  HIGH_CANCELLATION_RATE,
  HIGH_CHECK_IN_RATE,
  HIGH_NO_SHOW_RATE,
  INSIGHTS_MIN_RESOLVED,
  MAX_RECOMMENDATIONS,
} from '../insights.constants.js';
import type { InsightsMetrics } from '../metrics/insights-metrics.js';
import { percent } from '../reliability/reliability.js';

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

// El respaldo sin IA (docs/ia-diseno.md §9): reglas simples sobre las métricas,
// igual al prototipo (ai-prototype/narrative.py). Siempre devuelve un texto.
export function templateNarrative(metrics: InsightsMetrics): string {
  if (metrics.checkInRate === null) {
    return (
      'Aún no hay suficientes reservas para tu informe. Vuelve cuando tengas al menos ' +
      `${INSIGHTS_MIN_RESOLVED} reservas resueltas (con check-in, canceladas o vencidas); ` +
      `en los últimos ${metrics.daily.length} días llevas ${metrics.resolved}.`
    );
  }
  const { noShowRate, cancellationRate, checkInRate } = metrics;
  const days = metrics.daily.length;
  const recommendations: string[] = [];

  if (noShowRate !== null && noShowRate >= HIGH_NO_SHOW_RATE) {
    recommendations.push(
      `El ${percent(noShowRate)} % de tus reservas resueltas venció sin check-in ` +
        `(${metrics.expired} de ${metrics.resolved}). Revisa si validas el código cuando llega el ` +
        'comensal: si no lo validas, la reserva cuenta como vencida.',
    );
  }
  if (metrics.daysWithoutManualUpdates >= Math.ceil(days / 2)) {
    recommendations.push(
      `No actualizaste tus mesas a mano en ${metrics.daysWithoutManualUpdates} de ${days} días. ` +
        'Márcalas como Ocupada o Disponible cuando cambien, para que los comensales vean tu ' +
        'disponibilidad real.',
    );
  }
  if (cancellationRate !== null && cancellationRate >= HIGH_CANCELLATION_RATE) {
    recommendations.push(
      `El ${percent(cancellationRate)} % de tus reservas resueltas se canceló ` +
        `(${metrics.cancelled} de ${metrics.resolved}). Revisa en la bitácora a qué horas pasa.`,
    );
  }
  if (checkInRate >= HIGH_CHECK_IN_RATE) {
    recommendations.push(
      `El ${percent(checkInRate)} % de tus reservas resueltas terminó en check-in. ` +
        'Sigue validando el código al recibir a cada comensal.',
    );
  }
  const [slot] = metrics.topSlots;
  if (slot) {
    recommendations.push(
      `Tu franja con más reservas es el ${DAY_NAMES[slot.dayOfWeek]} a las ${formatHour(slot.hour)} ` +
        `(${slot.reservations} reservas). Procura tener mesas Disponibles a esa hora.`,
    );
  }
  return recommendations.slice(0, MAX_RECOMMENDATIONS).join(' ');
}
