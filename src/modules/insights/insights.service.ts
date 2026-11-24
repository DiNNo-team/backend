import { Injectable } from '@nestjs/common';
import {
  RestaurantMetricsService,
  type ReportPeriod,
} from '../reservations-checkin/index.js';
import { Clock } from '../search-availability/index.js';
import { InsightsCache } from './cache/insights-cache.js';
import type {
  InsightsPeriodDto,
  RestaurantInsightsResponseDto,
} from './dto/insights-response.dto.js';
import { INSIGHTS_MIN_RESOLVED } from './insights.constants.js';
import { InsightsActivityReader } from './metrics/insights-activity.reader.js';
import {
  buildInsightsMetrics,
  buildPreviousMetrics,
  dataSufficiency,
} from './metrics/insights-metrics.js';
import { NarrativeService } from './narrative/narrative.service.js';
import { insightsPeriods, periodDays } from './period/insights-period.js';
import { reliabilityOf } from './reliability/reliability.js';

// Cuánto se guarda un informe: con texto del modelo, una hora (controla el
// costo); con plantillas por una falla, 5 minutos, para reintentar pronto. La
// clave lleva el día, así un informe nunca pasa de un día al otro.
export const LLM_REPORT_TTL_SECONDS = 60 * 60;
export const TEMPLATE_REPORT_TTL_SECONDS = 5 * 60;

// El informe inteligente del restaurante de la sesión (docs/ia-diseno.md §6).
// De solo lectura: nunca cambia una reserva ni una mesa. Si el modelo falla, el
// texto sale de plantillas y la respuesta sigue siendo 200.
@Injectable()
export class InsightsService {
  constructor(
    private readonly metrics: RestaurantMetricsService,
    private readonly activity: InsightsActivityReader,
    private readonly narrative: NarrativeService,
    private readonly cache: InsightsCache,
    private readonly clock: Clock,
  ) {}

  async forRestaurant(
    restaurantId: string,
    options: { refresh: boolean },
  ): Promise<RestaurantInsightsResponseDto> {
    const now = this.clock.now();
    const { current, previous } = insightsPeriods(now);
    const cacheKey = `${restaurantId}:${current.to}`;

    if (!options.refresh) {
      const cached = await this.cache.get(cacheKey);
      if (cached !== null) {
        return JSON.parse(cached) as RestaurantInsightsResponseDto;
      }
    }

    const [summary, previousSummary, activity] = await Promise.all([
      this.metrics.forRestaurant(restaurantId, current),
      this.metrics.forRestaurant(restaurantId, previous),
      this.activity.forRestaurant(restaurantId, current),
    ]);
    const metrics = buildInsightsMetrics(
      summary,
      activity,
      periodDays(current),
    );
    const reliability = reliabilityOf(metrics);
    const previousMetrics = buildPreviousMetrics(previousSummary);
    const narrative = await this.narrative.write(
      metrics,
      reliability,
      previousMetrics,
    );

    const report: RestaurantInsightsResponseDto = {
      period: periodDto(current),
      previousPeriod: periodDto(previous),
      generatedAt: now.toISOString(),
      dataSufficiency: dataSufficiency(metrics.resolved),
      minResolved: INSIGHTS_MIN_RESOLVED,
      metrics,
      previous: previousMetrics,
      reliability,
      narrative,
    };
    await this.cache.set(
      cacheKey,
      JSON.stringify(report),
      narrative.source === 'llm'
        ? LLM_REPORT_TTL_SECONDS
        : TEMPLATE_REPORT_TTL_SECONDS,
    );
    return report;
  }
}

function periodDto({ from, to, timezone }: ReportPeriod): InsightsPeriodDto {
  return { from, to, timezone };
}
