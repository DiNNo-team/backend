import {
  HIGH_CHECK_IN_RATE,
  LOW_CHECK_IN_RATE,
} from '../insights.constants.js';
import type { InsightsMetrics } from '../metrics/insights-metrics.js';

export type ReliabilityLevel = 'high' | 'medium' | 'low';

export interface Reliability {
  // null con datos insuficientes (docs/ia-diseno.md §5).
  level: ReliabilityLevel | null;
  // Por qué ese nivel, en español, para que el restaurante sepa qué mejorar.
  reasons: string[];
}

export function percent(value: number): number {
  return Math.round(value * 100);
}

// Indicador de confiabilidad de la disponibilidad (docs/ia-diseno.md §5). Regla
// sin entrenamiento, igual al prototipo (ai-prototype/metrics.py):
// - alta: tasa de check-in ≥ 70 % y cambios manuales de mesas en más de la
//   mitad de los días;
// - baja: tasa de check-in < 40 % o ningún cambio manual en el periodo;
// - media: cualquier otro caso.
// No hay historial de Abierto/Cerrado, así que cuenta todos los días del
// periodo, no solo los abiertos.
export function reliabilityOf(metrics: InsightsMetrics): Reliability {
  if (metrics.checkInRate === null) {
    return { level: null, reasons: [] };
  }
  const days = metrics.daily.length;
  const reasons = [
    `Tasa de check-in del ${percent(metrics.checkInRate)} %`,
    `Actualizaste tus mesas a mano en ${metrics.daysWithManualUpdates} de ${days} días`,
  ];
  const mostDays = metrics.daysWithManualUpdates > days / 2;
  if (metrics.checkInRate >= HIGH_CHECK_IN_RATE && mostDays) {
    return { level: 'high', reasons };
  }
  if (metrics.checkInRate < LOW_CHECK_IN_RATE || metrics.manualUpdates === 0) {
    return { level: 'low', reasons };
  }
  return { level: 'medium', reasons };
}
