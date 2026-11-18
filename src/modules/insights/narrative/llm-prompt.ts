import { DAY_NAMES, MAX_NARRATIVE_LENGTH } from '../insights.constants.js';
import type { InsightsMetrics } from '../metrics/insights-metrics.js';
import { percent, type Reliability } from '../reliability/reliability.js';
import { formatHour } from './template-narrative.js';

// Instrucción fija para el modelo. El modelo nunca escribe números: escribe
// marcadores ({clave}) y el backend pone el valor con su unidad. Así un dato no
// puede aparecer con otra unidad ni con otro valor (docs/ia-diseno.md §6.3).
export const NARRATIVE_SYSTEM_PROMPT =
  'Eres el asistente de DiNNo, una plataforma de microreservas de mesas en restaurantes de Bogotá. ' +
  'Recibes en JSON los datos de un restaurante en un periodo: cada clave tiene su valor y lo que significa. ' +
  'Escribe 2 o 3 recomendaciones para el dueño del restaurante: en español de Colombia, tuteando, en texto ' +
  'plano, sin viñetas, sin numeración y sin títulos. ' +
  'NUNCA escribas números, cifras, porcentajes ni horas. Cuando necesites un dato, escribe su clave exacta ' +
  'entre llaves, por ejemplo {porcentaje_con_check_in} o {franja_1_hora}: el sistema pone el valor con su ' +
  'unidad (el signo % y el formato de hora ya vienen incluidos, no los escribas). Usa cada clave solo con el ' +
  'significado que dice el JSON. No inventes datos ni causas que el JSON no muestre. ' +
  `El texto final, con los valores ya puestos, debe tener máximo ${MAX_NARRATIVE_LENGTH} caracteres. ` +
  'Una reserva vencida sin check-in no prueba que el comensal no llegó: llámala «reserva que venció ' +
  'sin check-in». Usa las palabras de DiNNo: mesa, comensal, Disponible, Ocupada, check-in, código.';

export interface Placeholder {
  // El valor ya formateado, con su unidad: "65 %", "13:00", "viernes", "10".
  value: string;
  // Qué significa, para que el modelo use cada clave en su lugar.
  meaning: string;
}

// Clave → valor y significado. Es todo lo que sale hacia el proveedor del
// modelo: números agregados y etiquetas de un restaurante. Nunca el id, el
// nombre ni la dirección del restaurante, ni nada de un comensal
// (docs/ia-diseno.md §10). Solo se arma con datos suficientes.
export type Placeholders = Record<string, Placeholder>;

function count(value: number, meaning: string): Placeholder {
  return { value: String(value), meaning };
}

function pct(rate: number | null, meaning: string): Placeholder {
  return { value: `${percent(rate ?? 0)} %`, meaning };
}

// 9.5 → "9,5", como se escribe en Colombia.
function decimal(value: number): string {
  return String(value).replace('.', ',');
}

export function narrativePlaceholders(
  metrics: InsightsMetrics,
  reliability: Reliability,
): Placeholders {
  const placeholders: Placeholders = {
    dias_del_periodo: count(
      metrics.daily.length,
      'días del periodo del informe',
    ),
    reservas_creadas: count(
      metrics.reservationsCreated,
      'reservas creadas en el periodo',
    ),
    reservas_resueltas: count(
      metrics.resolved,
      'reservas que ya terminaron (con check-in, canceladas o vencidas)',
    ),
    reservas_con_check_in: count(
      metrics.completed,
      'reservas que terminaron en check-in',
    ),
    reservas_vencidas_sin_check_in: count(
      metrics.expired,
      'reservas que vencieron sin check-in',
    ),
    reservas_canceladas: count(
      metrics.cancelled,
      'reservas que el comensal canceló',
    ),
    porcentaje_con_check_in: pct(
      metrics.checkInRate,
      'de las reservas resueltas, qué porcentaje terminó en check-in',
    ),
    porcentaje_vencidas_sin_check_in: pct(
      metrics.noShowRate,
      'de las reservas resueltas, qué porcentaje venció sin check-in',
    ),
    porcentaje_canceladas: pct(
      metrics.cancellationRate,
      'de las reservas resueltas, qué porcentaje se canceló',
    ),
    cambios_manuales_de_mesas: count(
      metrics.manualUpdates,
      'veces que el restaurante cambió a mano el estado de una mesa en el periodo',
    ),
    dias_con_cambios_manuales: count(
      metrics.daysWithManualUpdates,
      'días en que el restaurante cambió a mano el estado de alguna mesa',
    ),
    dias_sin_cambios_manuales: count(
      metrics.daysWithoutManualUpdates,
      'días en que el restaurante no cambió a mano ninguna mesa',
    ),
  };
  if (metrics.medianMinutesToCheckIn !== null) {
    placeholders.mediana_minutos_hasta_check_in = {
      value: decimal(metrics.medianMinutesToCheckIn),
      meaning:
        'minutos que pasan normalmente entre crear la reserva y el check-in (mediana)',
    };
  }
  metrics.topSlots.forEach((slot, index) => {
    const n = index + 1;
    placeholders[`franja_${n}_dia`] = {
      value: DAY_NAMES[slot.dayOfWeek],
      meaning: `día de la semana de la franja número ${n} con más reservas`,
    };
    placeholders[`franja_${n}_hora`] = {
      value: formatHour(slot.hour),
      meaning: `hora de la franja número ${n} con más reservas`,
    };
    placeholders[`franja_${n}_reservas`] = count(
      slot.reservations,
      `reservas creadas en la franja número ${n}`,
    );
  });
  const level = reliabilityLabel(reliability);
  if (level !== null) {
    placeholders.confiabilidad_de_la_disponibilidad = {
      value: level,
      meaning:
        'qué tan confiable es la disponibilidad que ven los comensales (alta, media o baja)',
    };
  }
  return placeholders;
}

function reliabilityLabel({ level }: Reliability): string | null {
  if (level === 'high') return 'alta';
  if (level === 'medium') return 'media';
  if (level === 'low') return 'baja';
  return null;
}

// Lo que se envía al modelo: cada clave con su valor y su significado.
export function llmUserMessage(placeholders: Placeholders): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(placeholders).map(([key, { value, meaning }]) => [
        key,
        { valor: value, significa: meaning },
      ]),
    ),
  );
}

export type RenderedNarrative =
  { ok: true; text: string } | { ok: false; problem: string };

const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;

// Convierte el texto del modelo en el texto final, o dice por qué se descarta
// (docs/ia-diseno.md §6.3):
// - vacío;
// - con una clave que no existe;
// - con un número, un % o una llave suelta escritos por el modelo (los datos
//   solo pueden entrar por las claves);
// - de más de 600 caracteres ya con los valores puestos.
export function renderNarrative(
  text: string,
  placeholders: Placeholders,
): RenderedNarrative {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, problem: 'el modelo respondió vacío' };
  }
  const unknown = [...trimmed.matchAll(PLACEHOLDER)]
    .map(([, key]) => key)
    .filter((key) => !(key in placeholders));
  if (unknown.length > 0) {
    return {
      ok: false,
      problem: `el texto usa claves que no existen: ${unknown.join(', ')}`,
    };
  }
  const outside = trimmed.replace(PLACEHOLDER, '');
  const written = outside.match(/[\d%{}]/g);
  if (written) {
    return {
      ok: false,
      problem: `el texto escribe números o signos en vez de claves: ${[...new Set(written)].join(' ')}`,
    };
  }
  const rendered = trimmed.replace(
    PLACEHOLDER,
    (_, key: string) => placeholders[key].value,
  );
  if (rendered.length > MAX_NARRATIVE_LENGTH) {
    return {
      ok: false,
      problem: `el texto tiene ${rendered.length} caracteres (máximo ${MAX_NARRATIVE_LENGTH})`,
    };
  }
  return { ok: true, text: rendered };
}
