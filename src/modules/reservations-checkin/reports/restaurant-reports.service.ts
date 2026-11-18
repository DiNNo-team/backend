import { BadRequestException, Injectable } from '@nestjs/common';
import { Clock } from '../../search-availability/index.js';
import {
  bogotaMonthKey,
  parseBillingMonth,
  shiftMonth,
} from '../billing/billing-month.js';
import { BillingStatementService } from '../billing/billing-statement.service.js';
import { billingStatus } from '../billing/billing-status.js';
import { CheckInFeeConfig } from '../billing/checkin-fee.config.js';
import { PlatformBillingReader } from '../platform/platform-billing.reader.js';
import { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import type {
  BillingStatementResponseDto,
  RestaurantSummaryResponseDto,
  SummaryPaymentDto,
  SummaryPaymentMonthDto,
} from './dto/report-response.dto.js';
import { previousComparablePeriod } from './comparable-period.js';
import {
  parseReportPeriod,
  type ReportPeriod,
  type ReportPeriodQuery,
} from './report-period.js';
import { RestaurantMetricsService } from './restaurant-metrics.service.js';
import { RestaurantSummaryReader } from './restaurant-summary.reader.js';

// Meses del gráfico «Comensales por mes».
export const SUMMARY_MONTHS = 6;

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
    private readonly summaryReader: RestaurantSummaryReader,
    private readonly periods: PlatformBillingReader,
  ) {}

  async summary(
    restaurantId: string,
    query: ReportPeriodQuery,
  ): Promise<RestaurantSummaryResponseDto> {
    const period = this.periodOf(query);
    // Antes de contar: nada vencido debe contar como activo (§12.5).
    await this.expiration.expireDueForRestaurant(restaurantId);
    const comparable = previousComparablePeriod(period, this.clock.now());
    const currentMonth = bogotaMonthKey(this.clock.now());
    const [metrics, byDayHour, byDate, totals, previous, months, payment] =
      await Promise.all([
        this.metrics.forRestaurant(restaurantId, period),
        this.metrics.dayHourForRestaurant(restaurantId, period),
        this.summaryReader.daily(restaurantId, period),
        this.summaryReader.totals(restaurantId, period),
        this.summaryReader.totals(restaurantId, comparable),
        this.summaryReader.monthly(
          restaurantId,
          period.to.slice(0, 7),
          SUMMARY_MONTHS,
        ),
        this.payment(restaurantId, period),
      ]);
    return {
      period: periodDto(period),
      billing: {
        ...metrics.billing,
        guests: totals.guests,
        currentFeeCop: this.feeConfig.feeCop,
      },
      previousComparable: {
        period: periodDto(comparable),
        reservationsCreated: previous.reservationsCreated,
        checkIns: previous.checkIns,
        guests: previous.guests,
        amountCop: previous.amountCop,
      },
      reservations: metrics.reservations,
      rates: metrics.rates,
      averagePartySize: metrics.averagePartySize,
      peakHours: metrics.peakHours,
      byDayOfWeek: metrics.byDayOfWeek,
      byDate,
      byDayHour,
      monthly: months.map((month) => ({
        ...month,
        inProgress: month.month === currentMonth,
      })),
      payment,
      serverTime: this.clock.now().toISOString(),
    };
  }

  // Estado de pago del mes de `to` (solo si el periodo cabe en un mes) y del mes
  // anterior. La misma regla del panel del administrador (billingStatus).
  private async payment(
    restaurantId: string,
    period: ReportPeriod,
  ): Promise<SummaryPaymentDto> {
    const key = period.to.slice(0, 7);
    const [current, previous] = await Promise.all([
      period.from.slice(0, 7) === key
        ? this.paymentMonth(restaurantId, key)
        : Promise.resolve(null),
      this.paymentMonth(restaurantId, shiftMonth(key, -1)),
    ]);
    return { period: current, previousMonth: previous };
  }

  // null para un mes anterior a 2026-01 (el primero con cobro).
  private async paymentMonth(
    restaurantId: string,
    key: string,
  ): Promise<SummaryPaymentMonthDto | null> {
    const parsed = parseBillingMonth(key, this.clock.now());
    if (!parsed.ok) {
      return null;
    }
    const { month } = parsed;
    const [totals, row] = await Promise.all([
      this.billing.totals(restaurantId, month.period),
      this.periods.billingPeriod(restaurantId, month),
    ]);
    const status = billingStatus(month, row);
    const snapshot =
      status === 'paid' && row?.amountCopSnapshot != null ? row : null;
    return {
      month: key,
      status,
      checkIns: snapshot?.checkInsSnapshot ?? totals.checkIns,
      amountCop: snapshot?.amountCopSnapshot ?? totals.amountCop,
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
