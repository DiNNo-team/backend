import { BadRequestException, Injectable } from '@nestjs/common';
import {
  APPROVED,
  PENDING,
  REJECTED,
  SUSPENDED,
} from '../../identity-access/index.js';
import { restaurantNotFound } from '../../restaurant-operations/index.js';
import { Clock } from '../../search-availability/index.js';
import {
  bogotaMonthKey,
  MIN_BILLING_MONTH,
  monthsEndingAt,
  parseBillingMonth,
  shiftMonth,
  type BillingMonth,
} from '../billing/billing-month.js';
import { BillingStatementService } from '../billing/billing-statement.service.js';
import { CheckInFeeConfig } from '../billing/checkin-fee.config.js';
import {
  parseReportPeriod,
  type ReportPeriod,
  type ReportPeriodQuery,
} from '../reports/report-period.js';
import { RestaurantMetricsService } from '../reports/restaurant-metrics.service.js';
import { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import {
  METRICS_BASIS,
  type AdminActivityPageDto,
  type AdminBillingDetailDto,
  type AdminBillingPageDto,
  type AdminOverviewDto,
  type BillingStatus,
  type PlatformMetricsDto,
} from './dto/admin-platform-response.dto.js';
import {
  PlatformBillingReader,
  type BillingPeriodRow,
} from './platform-billing.reader.js';

export const OVERVIEW_MONTHS = 12;

export interface PageRequest {
  page: number;
  pageSize: number;
}

const iso = (value: Date | null): string | null =>
  value === null ? null : new Date(value).toISOString();

function periodDto({ from, to, timezone }: ReportPeriod) {
  return { from, to, timezone };
}

function billingStatus(
  month: BillingMonth,
  row: { status: string } | null,
): BillingStatus {
  if (!month.closed) {
    return 'in_progress';
  }
  return row?.status === 'paid' ? 'paid' : 'pending';
}

// Reportes del panel del administrador de DiNNo (Sprint 4): resuelve el mes o
// el periodo (400 con la lista de problemas) y arma cada respuesta. El SQL vive
// en PlatformBillingReader y, para lo que comparte con el restaurante, en
// BillingStatementService y RestaurantMetricsService: una sola regla de cobro y
// de métricas. Nunca devuelve datos de comensales.
@Injectable()
export class PlatformReportsService {
  constructor(
    private readonly reader: PlatformBillingReader,
    private readonly billing: BillingStatementService,
    private readonly metrics: RestaurantMetricsService,
    private readonly expiration: ReservationExpirationService,
    private readonly feeConfig: CheckInFeeConfig,
    private readonly clock: Clock,
  ) {}

  // AAAA-MM de la query o de la ruta → mes resuelto; 400 si no es válido.
  resolveMonth(text: string | undefined): BillingMonth {
    const result = parseBillingMonth(text, this.clock.now());
    if (!result.ok) {
      throw new BadRequestException(result.errors);
    }
    return result.month;
  }

  async overview(month: BillingMonth): Promise<AdminOverviewDto> {
    const currentKey = bogotaMonthKey(this.clock.now());
    const previousKey = shiftMonth(month.key, -1);
    const [monthly, counts, collectedCop, pendingCop] = await Promise.all([
      this.reader.monthlyTotals(
        monthsEndingAt(month.key, OVERVIEW_MONTHS)[0],
        month.key,
      ),
      this.reader.restaurantCounts(),
      this.reader.collectedCop(currentKey),
      this.reader.pendingCop(MIN_BILLING_MONTH, currentKey),
    ]);
    // monthly ya trae el mes y el anterior (12 meses que terminan en month).
    const byMonth = new Map(monthly.map((row) => [row.month, row]));
    const current = byMonth.get(month.key);
    return {
      month: month.key,
      monthStatus: month.closed ? 'closed' : 'in_progress',
      revenueCop: current?.revenueCop ?? 0,
      checkIns: current?.checkIns ?? 0,
      previousMonth: previousKey,
      previousRevenueCop: byMonth.get(previousKey)?.revenueCop ?? 0,
      monthly,
      collectedCop,
      pendingCop,
      restaurants: {
        pending: counts[PENDING] ?? 0,
        approved: counts[APPROVED] ?? 0,
        suspended: counts[SUSPENDED] ?? 0,
        rejected: counts[REJECTED] ?? 0,
      },
      currentFeeCop: this.feeConfig.feeCop,
      serverTime: this.clock.now().toISOString(),
    };
  }

  async billingList(
    month: BillingMonth,
    { page, pageSize }: PageRequest,
  ): Promise<AdminBillingPageDto> {
    const [list, totals, byStatus] = await Promise.all([
      this.reader.billingPage(month, page, pageSize),
      this.billing.platformTotals(month.period),
      month.closed
        ? this.reader.monthStatusTotals(month)
        : Promise.resolve({ paidCop: 0, pendingCop: 0 }),
    ]);
    return {
      month: month.key,
      monthStatus: month.closed ? 'closed' : 'in_progress',
      period: periodDto(month.period),
      totals: {
        checkIns: totals.checkIns,
        amountCop: totals.amountCop,
        ...byStatus,
      },
      items: list.rows.map((row) => ({
        restaurantId: row.restaurantId,
        name: row.name,
        approvalStatus: row.approvalStatus,
        checkIns: row.checkIns,
        amountCop: row.amountCop,
        status: billingStatus(
          month,
          row.periodStatus === null ? null : { status: row.periodStatus },
        ),
        paidAt:
          month.closed && row.periodStatus === 'paid' ? iso(row.paidAt) : null,
      })),
      total: list.total,
      page,
      pageSize,
      serverTime: this.clock.now().toISOString(),
    };
  }

  // 404 RESTAURANT_NOT_FOUND si no existe. Los check-ins salen del estado de
  // cuenta del restaurante, sin la mesa ni la reserva: solo lo de negocio.
  async billingDetail(
    restaurantId: string,
    month: BillingMonth,
    { page, pageSize }: PageRequest,
  ): Promise<AdminBillingDetailDto> {
    const header = await this.reader.restaurantHeader(restaurantId);
    if (header === null) {
      throw restaurantNotFound();
    }
    const [statement, row] = await Promise.all([
      this.billing.statement(restaurantId, month.period, { page, pageSize }),
      this.reader.billingPeriod(restaurantId, month),
    ]);
    const status = billingStatus(month, row);
    const snapshot = status === 'paid' ? snapshotOf(row) : null;
    return {
      restaurant: header,
      month: month.key,
      period: periodDto(month.period),
      status,
      totalCheckIns: statement.totalCheckIns,
      amountCop: statement.amountCop,
      paidAt: status === 'paid' ? iso(row?.markedPaidAt ?? null) : null,
      snapshot,
      amountMismatch:
        snapshot !== null &&
        (snapshot.amountCop !== statement.amountCop ||
          snapshot.checkIns !== statement.totalCheckIns),
      items: statement.items.map((item) => ({
        checkInId: item.checkInId,
        checkedInAt: item.checkedInAt,
        partySize: item.partySize,
        feeCop: item.feeCop,
      })),
      page,
      pageSize,
      serverTime: this.clock.now().toISOString(),
    };
  }

  async activity(
    month: BillingMonth,
    { page, pageSize }: PageRequest,
  ): Promise<AdminActivityPageDto> {
    const list = await this.reader.activityPage(month, page, pageSize);
    return {
      month: month.key,
      period: periodDto(month.period),
      items: list.rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        approvalStatus: row.approvalStatus,
        isOpen: row.isOpen,
        approvedAt: iso(row.approvedAt),
        createdAt: new Date(row.createdAt).toISOString(),
        checkIns: row.checkIns,
        amountCop: row.amountCop,
        lastTableActivityAt: iso(row.lastTableActivityAt),
      })),
      total: list.total,
      page,
      pageSize,
      serverTime: this.clock.now().toISOString(),
    };
  }

  // Antes de contar vence TODAS las reservas debidas (el mismo barrido global
  // del proceso periódico): nada vencido cuenta como activo.
  async platformMetrics(query: ReportPeriodQuery): Promise<PlatformMetricsDto> {
    const result = parseReportPeriod(
      { from: query.from, to: query.to },
      this.clock.now(),
    );
    if (!result.ok) {
      throw new BadRequestException(result.errors);
    }
    await this.expiration.expireAllDue();
    const metrics = await this.metrics.forPlatform(result.period);
    return {
      period: periodDto(result.period),
      basis: METRICS_BASIS,
      reservations: metrics.reservations,
      rates: metrics.rates,
      averagePartySize: metrics.averagePartySize,
      peakHours: metrics.hourly,
      byDayOfWeek: metrics.byDayOfWeek,
      serverTime: this.clock.now().toISOString(),
    };
  }
}

function snapshotOf(
  row: BillingPeriodRow | null,
): { amountCop: number; checkIns: number } | null {
  if (row?.amountCopSnapshot == null || row.checkInsSnapshot == null) {
    return null;
  }
  return { amountCop: row.amountCopSnapshot, checkIns: row.checkInsSnapshot };
}
