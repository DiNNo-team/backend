import { BadRequestException, Injectable } from '@nestjs/common';
import { Clock } from '../../search-availability/index.js';
import { BillingStatementService } from '../billing/billing-statement.service.js';
import { CheckInFeeConfig } from '../billing/checkin-fee.config.js';
import { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import type {
  BillingStatementResponseDto,
  RestaurantSummaryResponseDto,
} from './dto/report-response.dto.js';
import {
  parseReportPeriod,
  type ReportPeriod,
  type ReportPeriodQuery,
} from './report-period.js';
import { RestaurantMetricsService } from './restaurant-metrics.service.js';

// Los reportes del restaurante de la sesión (CLAUDE.md §11, "Cobro por
// check-in" y "Resumen y KPIs"): resuelve el periodo y arma la respuesta. Las
// agregaciones viven en RestaurantMetricsService y BillingStatementService.
@Injectable()
export class RestaurantReportsService {
  constructor(
    private readonly metrics: RestaurantMetricsService,
    private readonly billing: BillingStatementService,
    private readonly expiration: ReservationExpirationService,
    private readonly feeConfig: CheckInFeeConfig,
    private readonly clock: Clock,
  ) {}

  async summary(
    restaurantId: string,
    query: ReportPeriodQuery,
  ): Promise<RestaurantSummaryResponseDto> {
    const period = this.periodOf(query);
    // Antes de contar: nada vencido debe contar como activo (§12.5).
    await this.expiration.expireDueForRestaurant(restaurantId);
    const metrics = await this.metrics.forRestaurant(restaurantId, period);
    return {
      period: periodDto(period),
      billing: { ...metrics.billing, currentFeeCop: this.feeConfig.feeCop },
      reservations: metrics.reservations,
      rates: metrics.rates,
      averagePartySize: metrics.averagePartySize,
      peakHours: metrics.peakHours,
      byDayOfWeek: metrics.byDayOfWeek,
      serverTime: this.clock.now().toISOString(),
    };
  }

  async billingStatement(
    restaurantId: string,
    query: ReportPeriodQuery & { page: number; pageSize: number },
  ): Promise<BillingStatementResponseDto> {
    const period = this.periodOf(query);
    const { page, pageSize } = query;
    const statement = await this.billing.statement(restaurantId, period, {
      page,
      pageSize,
    });
    return {
      period: periodDto(period),
      ...statement,
      page,
      pageSize,
      serverTime: this.clock.now().toISOString(),
    };
  }

  // 400 con la lista de problemas, como los demás errores de validación.
  private periodOf(query: ReportPeriodQuery): ReportPeriod {
    const result = parseReportPeriod(
      { from: query.from, to: query.to },
      this.clock.now(),
    );
    if (!result.ok) {
      throw new BadRequestException(result.errors);
    }
    return result.period;
  }
}

function periodDto({ from, to, timezone }: ReportPeriod) {
  return { from, to, timezone };
}
