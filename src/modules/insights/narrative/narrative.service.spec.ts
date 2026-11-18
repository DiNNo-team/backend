import { Logger } from '@nestjs/common';
import {
  enoughMetrics,
  insufficientMetrics,
} from '../../../../test/support/insights-data.js';
import { reliabilityOf } from '../reliability/reliability.js';
import { LlmClient, type LlmResult } from './llm-client.js';
import { NarrativeService } from './narrative.service.js';
import { templateNarrative } from './template-narrative.js';

function llmAnswering(result: LlmResult, enabled = true) {
  const complete = vi.fn().mockResolvedValue(result);
  const llm = { enabled, complete } as unknown as LlmClient;
  return { llm, complete };
}

describe('NarrativeService', () => {
  const metrics = enoughMetrics();
  const reliability = reliabilityOf(metrics);
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('usa el texto del modelo con los valores puestos en sus claves', async () => {
    const { llm, complete } = llmAnswering({
      ok: true,
      text: 'El {porcentaje_vencidas_sin_check_in} de tus reservas venció sin check-in.',
    });

    await expect(
      new NarrativeService(llm).write(metrics, reliability),
    ).resolves.toEqual({
      text: 'El 25 % de tus reservas venció sin check-in.',
      source: 'llm',
      fallback: null,
    });
    const [request] = complete.mock.calls[0] as [
      { user: string; system: string },
    ];
    expect(JSON.parse(request.user)).toMatchObject({
      porcentaje_con_check_in: { valor: '65 %' },
    });
    expect(request.system).toContain('NUNCA escribas números');
    expect(warn).not.toHaveBeenCalled();
  });

  it('con datos insuficientes nunca llama al modelo', async () => {
    const { llm, complete } = llmAnswering({ ok: true, text: 'x' });
    const few = insufficientMetrics();

    await expect(
      new NarrativeService(llm).write(few, reliabilityOf(few)),
    ).resolves.toEqual({
      text: templateNarrative(few),
      source: 'template',
      fallback: 'insufficient_data',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('sin llave usa plantillas sin llamar ni avisar', async () => {
    const { llm, complete } = llmAnswering(
      { ok: false, reason: 'falta INSIGHTS_LLM_API_KEY' },
      false,
    );

    await expect(
      new NarrativeService(llm).write(metrics, reliability),
    ).resolves.toMatchObject({ source: 'template', fallback: 'llm_disabled' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('si el modelo falla, plantillas y el motivo en el log', async () => {
    const { llm } = llmAnswering({
      ok: false,
      reason: 'el modelo no respondió en 20 s',
    });

    await expect(
      new NarrativeService(llm).write(metrics, reliability),
    ).resolves.toEqual({
      text: templateNarrative(metrics),
      source: 'template',
      fallback: 'llm_unavailable',
    });
    expect(warn).toHaveBeenCalledWith(
      'Informe de IA con plantillas: el modelo no respondió en 20 s.',
    );
  });

  it('si el modelo escribe un número en vez de una clave, plantillas y el motivo en el log', async () => {
    const { llm } = llmAnswering({
      ok: true,
      text: 'El 99 % de tus reservas terminó en check-in.',
    });

    await expect(
      new NarrativeService(llm).write(metrics, reliability),
    ).resolves.toMatchObject({ source: 'template', fallback: 'llm_invalid' });
    expect(warn).toHaveBeenCalledWith(
      'Informe de IA con plantillas: el texto escribe números o signos en vez de claves: 9 %.',
    );
  });

  it('si el texto llega vacío, plantillas', async () => {
    const { llm } = llmAnswering({ ok: true, text: '' });

    await expect(
      new NarrativeService(llm).write(metrics, reliability),
    ).resolves.toMatchObject({ source: 'template', fallback: 'llm_invalid' });
  });
});
