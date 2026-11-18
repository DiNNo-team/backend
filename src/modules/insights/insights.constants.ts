// Informe inteligente del restaurante (Sprint 4, Feature 2; docs/ia-diseno.md).
// Las cifras de la regla viven aquí, en un solo lugar.

// Días del periodo del informe: los últimos 7 días de Bogotá, hoy incluido, y
// se comparan con los 7 anteriores.
export const INSIGHTS_PERIOD_DAYS = 7;

// Con menos reservas resueltas (con check-in, canceladas o vencidas) no se
// calculan tasas ni el indicador: el informe muestra solo conteos y el aviso
// de datos insuficientes (docs/ia-diseno.md §4.3). Valor inicial del equipo:
// se revisa con los datos del piloto.
export const INSIGHTS_MIN_RESOLVED = 10;

// Indicador de confiabilidad (docs/ia-diseno.md §5). Mismos valores iniciales
// que el prototipo (ai-prototype/metrics.py).
export const HIGH_CHECK_IN_RATE = 0.7;
export const LOW_CHECK_IN_RATE = 0.4;

// Plantillas (respaldo): cuándo una tasa merece una recomendación.
export const HIGH_NO_SHOW_RATE = 0.3;
export const HIGH_CANCELLATION_RATE = 0.25;

// Máximo de recomendaciones en el texto y de franjas con más reservas.
export const MAX_RECOMMENDATIONS = 3;
export const TOP_SLOTS_LIMIT = 3;

// Texto del modelo: más largo que esto se descarta (docs/ia-diseno.md §6.3).
export const MAX_NARRATIVE_LENGTH = 600;

// Días de la semana ISO (1 = lunes … 7 = domingo), como restaurant_schedules.
export const DAY_NAMES: Record<number, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado',
  7: 'domingo',
};
