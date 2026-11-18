import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityAccessModule } from '../identity-access/index.js';
import { ReservationsCheckinModule } from '../reservations-checkin/index.js';
import { SearchAvailabilityModule } from '../search-availability/index.js';
import { InsightsCache, RedisInsightsCache } from './cache/insights-cache.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';
import { InsightsActivityReader } from './metrics/insights-activity.reader.js';
import { createLlmClient, LlmClient } from './narrative/llm-client.js';
import { NarrativeService } from './narrative/narrative.service.js';

// Informe inteligente del restaurante (Sprint 4, Feature 2; docs/ia-diseno.md).
// Solo lee: reutiliza RestaurantMetricsService (exportado por
// reservations-checkin) y nadie depende de este módulo. Sin
// INSIGHTS_LLM_API_KEY funciona con plantillas.
@Module({
  imports: [
    IdentityAccessModule,
    ReservationsCheckinModule,
    // Clock, la fuente de la hora.
    SearchAvailabilityModule,
  ],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    InsightsActivityReader,
    NarrativeService,
    { provide: InsightsCache, useClass: RedisInsightsCache },
    {
      provide: LlmClient,
      inject: [ConfigService],
      useFactory: createLlmClient,
    },
  ],
})
export class InsightsModule {}
