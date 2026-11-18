import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AnthropicLlmClient,
  createLlmClient,
  DEFAULT_INSIGHTS_MODEL,
  DisabledLlmClient,
} from './llm-client.js';

function clientAnswering(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

function message(
  overrides: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_INSIGHTS_MODEL,
    content: [{ type: 'text', text: '  El 25 % venció sin check-in.  ' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...overrides,
  } as Anthropic.Message;
}

const REQUEST = { system: 'instrucción', user: '{"tasa_check_in_pct":65}' };

describe('AnthropicLlmClient', () => {
  it('pide el texto con poco esfuerzo y devuelve solo los bloques de texto', async () => {
    const create = vi.fn().mockResolvedValue(
      message({
        content: [
          { type: 'thinking', thinking: '', signature: 's' },
          { type: 'text', text: 'Primera. ' },
          { type: 'text', text: 'Segunda.' },
        ] as Anthropic.Message['content'],
      }),
    );
    const llm = new AnthropicLlmClient(clientAnswering(create), 'model-x');

    await expect(llm.complete(REQUEST)).resolves.toEqual({
      ok: true,
      text: 'Primera. Segunda.',
    });
    expect(create).toHaveBeenCalledWith({
      model: 'model-x',
      max_tokens: 16_000,
      output_config: { effort: 'low' },
      system: 'instrucción',
      messages: [{ role: 'user', content: '{"tasa_check_in_pct":65}' }],
    });
  });

  it('una negativa o un corte no es un texto', async () => {
    const refused = new AnthropicLlmClient(
      clientAnswering(
        vi.fn().mockResolvedValue(message({ stop_reason: 'refusal' })),
      ),
      'm',
    );
    await expect(refused.complete(REQUEST)).resolves.toEqual({
      ok: false,
      reason: 'el modelo terminó con stop_reason=refusal',
    });

    const cut = new AnthropicLlmClient(
      clientAnswering(
        vi.fn().mockResolvedValue(message({ stop_reason: 'max_tokens' })),
      ),
      'm',
    );
    await expect(cut.complete(REQUEST)).resolves.toMatchObject({ ok: false });
  });

  it.each([
    [
      new Anthropic.APIConnectionTimeoutError(),
      'el modelo no respondió en 20 s',
    ],
    [
      new Anthropic.APIConnectionError({ message: 'sin red' }),
      'no hubo conexión con el modelo',
    ],
    [
      new Anthropic.RateLimitError(429, undefined, 'límite', new Headers()),
      'el modelo respondió 429 (límite de peticiones o cupo agotado)',
    ],
    [
      new Anthropic.AuthenticationError(401, undefined, 'llave', new Headers()),
      'el modelo respondió 401 (revisa INSIGHTS_LLM_API_KEY)',
    ],
    [
      new Anthropic.NotFoundError(404, undefined, 'modelo', new Headers()),
      'el modelo respondió 404 (revisa INSIGHTS_LLM_MODEL)',
    ],
    [
      new Anthropic.InternalServerError(
        529,
        undefined,
        'ocupado',
        new Headers(),
      ),
      'el modelo respondió 529',
    ],
    [new TypeError('x'), 'error inesperado (TypeError)'],
  ])('nunca lanza: %s → un motivo', async (error, reason) => {
    const llm = new AnthropicLlmClient(
      clientAnswering(vi.fn().mockRejectedValue(error)),
      'm',
    );
    await expect(llm.complete(REQUEST)).resolves.toEqual({ ok: false, reason });
  });
});

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('createLlmClient', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin llave (o solo espacios) usa plantillas', async () => {
    const withoutKey: Record<string, string>[] = [
      {},
      { INSIGHTS_LLM_API_KEY: '   ' },
    ];
    for (const values of withoutKey) {
      const llm = createLlmClient(config(values));
      expect(llm).toBeInstanceOf(DisabledLlmClient);
      expect(llm.enabled).toBe(false);
      await expect(llm.complete(REQUEST)).resolves.toEqual({
        ok: false,
        reason: 'falta INSIGHTS_LLM_API_KEY',
      });
    }
  });

  it('con llave usa Claude Haiku 5.5 por defecto', () => {
    const llm = createLlmClient(config({ INSIGHTS_LLM_API_KEY: 'sk-test' }));
    expect(llm).toBeInstanceOf(AnthropicLlmClient);
    expect(llm.enabled).toBe(true);
    expect(DEFAULT_INSIGHTS_MODEL).toBe('claude-haiku-5-5');
  });
});
