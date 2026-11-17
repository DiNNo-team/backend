import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

export interface LlmRequest {
  system: string;
  user: string;
}

// Texto del modelo, o el motivo por el que no hubo texto (para el log). El
// motivo nunca lleva la llave ni el contenido enviado.
export type LlmResult =
  { ok: true; text: string } | { ok: false; reason: string };

// Puerto: quién redacta el texto. El informe depende de esto, nunca del SDK,
// así las pruebas lo reemplazan. Nunca lanza: una falla es un resultado.
export abstract class LlmClient {
  abstract readonly enabled: boolean;
  abstract complete(request: LlmRequest): Promise<LlmResult>;
}

export const DEFAULT_INSIGHTS_MODEL = 'claude-haiku-5-5';

// Una sola espera corta y sin reintentos del SDK: si el modelo no responde a
// tiempo, el informe sale con plantillas (docs/ia-diseno.md §9) y la persona
// no se queda esperando.
export const LLM_TIMEOUT_MS = 20_000;

// Respuesta corta (2 o 3 recomendaciones, máximo 600 caracteres). Margen para
// el razonamiento del modelo, que en Claude Haiku 5.5 siempre está activo.
const MAX_TOKENS = 16_000;

export class AnthropicLlmClient extends LlmClient {
  readonly enabled = true;

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {
    super();
  }

  async complete({ system, user }: LlmRequest): Promise<LlmResult> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // Tarea corta de redacción: poco esfuerzo, más rápido y más barato.
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      });
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
    if (response.stop_reason !== 'end_turn') {
      return {
        ok: false,
        reason: `el modelo terminó con stop_reason=${response.stop_reason ?? 'null'}`,
      };
    }
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    return { ok: true, text };
  }
}

// Del más específico al más general (errores tipados del SDK).
function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return `el modelo no respondió en ${LLM_TIMEOUT_MS / 1000} s`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'no hubo conexión con el modelo';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'el modelo respondió 429 (límite de peticiones o cupo agotado)';
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'el modelo respondió 401 (revisa INSIGHTS_LLM_API_KEY)';
  }
  if (error instanceof Anthropic.NotFoundError) {
    return 'el modelo respondió 404 (revisa INSIGHTS_LLM_MODEL)';
  }
  if (error instanceof Anthropic.APIError) {
    return `el modelo respondió ${error.status ?? 'sin estado'}`;
  }
  return `error inesperado (${error instanceof Error ? error.name : 'desconocido'})`;
}

// Sin llave, el informe siempre usa plantillas y funciona completo.
export class DisabledLlmClient extends LlmClient {
  readonly enabled = false;

  complete(): Promise<LlmResult> {
    return Promise.resolve({
      ok: false,
      reason: 'falta INSIGHTS_LLM_API_KEY',
    });
  }
}

/**
 * El cliente de la app: Claude (Anthropic) con INSIGHTS_LLM_API_KEY y el modelo
 * de INSIGHTS_LLM_MODEL (por defecto Claude Haiku 5.5). Sin llave, el informe
 * usa plantillas y la API arranca igual. La llave nunca va al log.
 */
export function createLlmClient(config: ConfigService): LlmClient {
  const logger = new Logger('Insights');
  const apiKey = config.get<string>('INSIGHTS_LLM_API_KEY')?.trim();
  if (!apiKey) {
    logger.warn(
      'Informe de IA sin modelo de lenguaje: falta INSIGHTS_LLM_API_KEY. El texto sale de plantillas.',
    );
    return new DisabledLlmClient();
  }
  const model =
    config.get<string>('INSIGHTS_LLM_MODEL')?.trim() || DEFAULT_INSIGHTS_MODEL;
  logger.log(`Informe de IA con el modelo ${model}.`);
  return new AnthropicLlmClient(
    new Anthropic({ apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 0 }),
    model,
  );
}
