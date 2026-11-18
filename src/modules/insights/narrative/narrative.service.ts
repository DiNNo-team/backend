import { Injectable, Logger } from '@nestjs/common';
import type { InsightsMetrics } from '../metrics/insights-metrics.js';
import type { Reliability } from '../reliability/reliability.js';
import { LlmClient } from './llm-client.js';
import {
  llmUserMessage,
  NARRATIVE_SYSTEM_PROMPT,
  narrativePlaceholders,
  renderNarrative,
} from './llm-prompt.js';
import { templateNarrative } from './template-narrative.js';

export type NarrativeSource = 'llm' | 'template';

// Por qué el texto salió de plantillas (null si lo escribió el modelo):
// - insufficient_data: pocas reservas resueltas; nunca se llama al modelo.
// - llm_disabled: no hay llave del modelo.
// - llm_unavailable: el modelo falló, tardó o se negó.
// - llm_invalid: el texto del modelo no pasó la validación.
export type NarrativeFallback =
  'insufficient_data' | 'llm_disabled' | 'llm_unavailable' | 'llm_invalid';

export interface Narrative {
  text: string;
  source: NarrativeSource;
  fallback: NarrativeFallback | null;
}

// Redacta el texto del informe (docs/ia-diseno.md §6.3 y §9): el modelo si
// hay datos suficientes y llave; si no, o si algo falla, plantillas. Nunca
// lanza: el informe siempre tiene texto. Cada uso del respaldo por una falla
// queda en el log con su motivo (sin datos del restaurante).
@Injectable()
export class NarrativeService {
  private readonly logger = new Logger('Insights');

  constructor(private readonly llm: LlmClient) {}

  async write(
    metrics: InsightsMetrics,
    reliability: Reliability,
  ): Promise<Narrative> {
    const template = (fallback: NarrativeFallback): Narrative => ({
      text: templateNarrative(metrics),
      source: 'template',
      fallback,
    });
    if (metrics.checkInRate === null) {
      return template('insufficient_data');
    }
    if (!this.llm.enabled) {
      return template('llm_disabled');
    }
    const placeholders = narrativePlaceholders(metrics, reliability);
    const result = await this.llm.complete({
      system: NARRATIVE_SYSTEM_PROMPT,
      user: llmUserMessage(placeholders),
    });
    if (!result.ok) {
      this.logger.warn(`Informe de IA con plantillas: ${result.reason}.`);
      return template('llm_unavailable');
    }
    const rendered = renderNarrative(result.text, placeholders);
    if (!rendered.ok) {
      this.logger.warn(`Informe de IA con plantillas: ${rendered.problem}.`);
      return template('llm_invalid');
    }
    return { text: rendered.text, source: 'llm', fallback: null };
  }
}
