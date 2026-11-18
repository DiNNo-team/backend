import {
  emptyActivity,
  summaryWith,
} from '../../../test/support/insights-data.js';
import type { RestaurantMetricsService } from '../reservations-checkin/index.js';
import type { Clock } from '../search-availability/index.js';
import type { InsightsCache } from './cache/insights-cache.js';
import {
  InsightsService,
  LLM_REPORT_TTL_SECONDS,
  TEMPLATE_REPORT_TTL_SECONDS,
} from './insights.service.js';
import type { InsightsActivityReader } from './metrics/insights-activity.reader.js';
import type {
  Narrative,
  NarrativeService,
} from './narrative/narrative.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
// Martes 2026-11-17 09:00 en Bogotá.
const NOW = new Date('2026-11-17T14:00:00Z');

function setup(narrative: Narrative, cached: string | null = null) {
  const forRestaurant = vi
    .fn()
    .mockResolvedValueOnce(
      summaryWith({ created: 12, completed: 8, cancelled: 2, expired: 2 }),
    )
    .mockResolvedValueOnce(summaryWith({ created: 3, completed: 3 }));
  const activity = {
    forRestaurant: vi.fn().mockResolvedValue(emptyActivity()),
  };
  const write = vi.fn().mockResolvedValue(narrative);
  const cache = {
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const service = new InsightsService(
    { forRestaurant } as unknown as RestaurantMetricsService,
    activity as unknown as InsightsActivityReader,
    { write } as unknown as NarrativeService,
    cache as unknown as InsightsCache,
    { now: () => NOW } as Clock,
  );
  return { service, forRestaurant, activity, write, cache };
}

const LLM: Narrative = { text: 'Texto.', source: 'llm', fallback: null };
const TEMPLATE: Narrative = {
  text: 'Plantilla.',
  source: 'template',
  fallback: 'llm_unavailable',
};

describe('InsightsService', () => {
  it('calcula los dos periodos del restaurante de la sesión y arma el informe', async () => {
    const { service, forRestaurant, activity } = setup(LLM);

    const report = await service.forRestaurant(RESTAURANT_ID, {
      refresh: false,
    });

    expect(forRestaurant).toHaveBeenNthCalledWith(
      1,
      RESTAURANT_ID,
      expect.objectContaining({ from: '2026-11-11', to: '2026-11-17' }),
    );
    expect(forRestaurant).toHaveBeenNthCalledWith(
      2,
      RESTAURANT_ID,
      expect.objectContaining({ from: '2026-11-04', to: '2026-11-10' }),
    );
    expect(activity.forRestaurant).toHaveBeenCalledWith(
      RESTAURANT_ID,
      expect.objectContaining({ from: '2026-11-11' }),
    );
    expect(report).toMatchObject({
      period: {
        from: '2026-11-11',
        to: '2026-11-17',
        timezone: 'America/Bogota',
      },
      previousPeriod: { from: '2026-11-04', to: '2026-11-10' },
      generatedAt: NOW.toISOString(),
      dataSufficiency: 'enough',
      minResolved: 10,
      metrics: { resolved: 12, checkInRate: 0.6667 },
      previous: { reservationsCreated: 3, resolved: 3, checkInRate: null },
      reliability: { level: 'low' },
      narrative: LLM,
    });
  });

  it('guarda el informe una hora si lo redactó el modelo, 5 minutos si salió de plantillas', async () => {
    const llm = setup(LLM);
    await llm.service.forRestaurant(RESTAURANT_ID, { refresh: false });
    expect(llm.cache.set).toHaveBeenCalledWith(
      `${RESTAURANT_ID}:2026-11-17`,
      expect.any(String),
      LLM_REPORT_TTL_SECONDS,
    );

    const template = setup(TEMPLATE);
    await template.service.forRestaurant(RESTAURANT_ID, { refresh: false });
    expect(template.cache.set).toHaveBeenCalledWith(
      `${RESTAURANT_ID}:2026-11-17`,
      expect.any(String),
      TEMPLATE_REPORT_TTL_SECONDS,
    );
  });

  it('devuelve el informe guardado sin consultar la base ni el modelo', async () => {
    const cached = JSON.stringify({ generatedAt: '2026-11-17T13:00:00.000Z' });
    const { service, forRestaurant, write } = setup(LLM, cached);

    await expect(
      service.forRestaurant(RESTAURANT_ID, { refresh: false }),
    ).resolves.toEqual({ generatedAt: '2026-11-17T13:00:00.000Z' });
    expect(forRestaurant).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('con refresh genera de nuevo aunque haya uno guardado', async () => {
    const { service, cache, write } = setup(LLM, '{"viejo":true}');

    const report = await service.forRestaurant(RESTAURANT_ID, {
      refresh: true,
    });

    expect(cache.get).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(report.narrative).toEqual(LLM);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });
});
