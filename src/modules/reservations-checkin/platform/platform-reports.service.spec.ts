import { HttpException } from '@nestjs/common';
import type { Clock } from '../../search-availability/index.js';
import type { BillingStatementService } from '../billing/billing-statement.service.js';
import type { CheckInFeeConfig } from '../billing/checkin-fee.config.js';
import { BILLING_MONTH_MESSAGES } from '../billing/billing-month.js';
import { REPORT_PERIOD_MESSAGES } from '../reports/report-period.js';
import type { RestaurantMetricsService } from '../reports/restaurant-metrics.service.js';
import type { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import type {
  BillingListRow,
  BillingPeriodRow,
  PlatformBillingReader,
} from './platform-billing.reader.js';
import { PlatformReportsService } from './platform-reports.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
// 2026-11-17 10:00 en Bogotá.
const NOW = new Date('2026-11-17T15:00:00Z');
const PAID_AT = new Date('2026-11-03T16:00:00Z');

function listRow(fields: Partial<BillingListRow>): BillingListRow {
  return {
    restaurantId: RESTAURANT_ID,
    name: 'Casa 72',
    approvalStatus: 'approved',
    checkIns: 3,
    amountCop: 6000,
    periodStatus: null,
    paidAt: null,
    ...fields,
  };
}

function createService({
  period = null as BillingPeriodRow | null,
  statementTotals = { totalCheckIns: 3, amountCop: 6000 },
  header = true,
  rows = [listRow({})],
} = {}) {
  const order: string[] = [];
  const reader = {
    monthlyTotals: vi.fn((first: string, last: string) =>
      Promise.resolve(
        [first, '2026-10', last].map((month, index) => ({
          month,
          revenueCop: index * 1000,
          checkIns: index,
        })),
      ),
    ),
    restaurantCounts: vi.fn(() =>
      Promise.resolve({ approved: 15, suspended: 1 }),
    ),
    collectedCop: vi.fn(() => Promise.resolve(4000)),
    pendingCop: vi.fn(() => Promise.resolve(2000)),
    billingPage: vi.fn(() => Promise.resolve({ rows, total: rows.length })),
    monthStatusTotals: vi.fn(() =>
      Promise.resolve({ paidCop: 4000, pendingCop: 2000 }),
    ),
    restaurantHeader: vi.fn(() =>
      Promise.resolve(
        header
          ? { id: RESTAURANT_ID, name: 'Casa 72', approvalStatus: 'approved' }
          : null,
      ),
    ),
    billingPeriod: vi.fn(() => Promise.resolve(period)),
    activityPage: vi.fn(() => Promise.resolve({ rows: [], total: 0 })),
  };
  const billing = {
    platformTotals: vi.fn(() =>
      Promise.resolve({ checkIns: 9, amountCop: 18000 }),
    ),
    statement: vi.fn(() =>
      Promise.resolve({
        ...statementTotals,
        items: [
          {
            checkInId: 'c-1',
            reservationId: 'r-1',
            checkedInAt: '2026-10-14T22:05:00.000Z',
            partySize: 4,
            tableIdentifier: '04',
            feeCop: 2000,
          },
        ],
      }),
    ),
  };
  const metrics = {
    forPlatform: vi.fn(() => {
      order.push('metrics');
      return Promise.resolve({
        billing: { checkIns: 0, amountCop: 0 },
        reservations: {
          created: 0,
          completed: 0,
          cancelled: 0,
          expired: 0,
          active: 0,
        },
        rates: { conversion: null, noShow: null, cancellation: null },
        averagePartySize: null,
        hourly: [],
        byDayOfWeek: [],
        byDate: [{ date: '2026-11-01', reservations: 0 }],
        byDayHour: [{ dayOfWeek: 1, hour: 0, reservations: 0 }],
      });
    }),
  };
  const expiration = {
    expireAllDue: vi.fn(() => {
      order.push('expire');
      return Promise.resolve(0);
    }),
  };
  const clock: Clock = { now: () => NOW };
  const service = new PlatformReportsService(
    reader as unknown as PlatformBillingReader,
    billing as unknown as BillingStatementService,
    metrics as unknown as RestaurantMetricsService,
    expiration as unknown as ReservationExpirationService,
    { feeCop: 2000 } as CheckInFeeConfig,
    clock,
  );
  return { service, reader, billing, expiration, order };
}

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('PlatformReportsService', () => {
  it('resolveMonth answers 400 with the list of problems', () => {
    const { service } = createService();

    expect(() => service.resolveMonth('2026-12')).toThrow(HttpException);
    try {
      service.resolveMonth('2026-12');
    } catch (error) {
      expect((error as HttpException).getResponse()).toMatchObject({
        statusCode: 400,
        message: [BILLING_MONTH_MESSAGES.IN_FUTURE],
      });
    }
  });

  describe('overview', () => {
    it('takes the month and the previous one from the 12-month series', async () => {
      const { service, reader } = createService();

      const overview = await service.overview(service.resolveMonth('2026-11'));

      expect(reader.monthlyTotals).toHaveBeenCalledWith('2025-12', '2026-11');
      expect(overview).toMatchObject({
        month: '2026-11',
        monthStatus: 'in_progress',
        revenueCop: 2000,
        checkIns: 2,
        previousMonth: '2026-10',
        previousRevenueCop: 1000,
        collectedCop: 4000,
        pendingCop: 2000,
        currentFeeCop: 2000,
        serverTime: NOW.toISOString(),
      });
      // Los estados sin restaurantes salen en 0, nunca ausentes.
      expect(overview.restaurants).toEqual({
        pending: 0,
        approved: 15,
        suspended: 1,
        rejected: 0,
      });
    });

    it('counts collected and pending from 2026-01 up to the current month, whatever month is asked', async () => {
      const { service, reader } = createService();

      await service.overview(service.resolveMonth('2026-03'));

      expect(reader.collectedCop).toHaveBeenCalledWith('2026-11');
      expect(reader.pendingCop).toHaveBeenCalledWith('2026-01', '2026-11');
    });
  });

  describe('billingList', () => {
    it('the month in progress: every row in_progress, nothing paid or pending yet', async () => {
      const { service, reader } = createService({
        rows: [listRow({ periodStatus: 'paid', paidAt: PAID_AT })],
      });

      const page = await service.billingList(service.resolveMonth('2026-11'), {
        page: 1,
        pageSize: 20,
      });

      expect(page.monthStatus).toBe('in_progress');
      expect(page.items[0]).toMatchObject({
        status: 'in_progress',
        paidAt: null,
      });
      expect(page.totals).toEqual({
        checkIns: 9,
        amountCop: 18000,
        paidCop: 0,
        pendingCop: 0,
      });
      expect(reader.monthStatusTotals).not.toHaveBeenCalled();
    });

    it('a closed month: paid with its date, pending without a row or with a pending row', async () => {
      const { service } = createService({
        rows: [
          listRow({ periodStatus: 'paid', paidAt: PAID_AT }),
          listRow({ restaurantId: 'r-2', periodStatus: 'pending' }),
          listRow({
            restaurantId: 'r-3',
            periodStatus: null,
            amountCop: 0,
            checkIns: 0,
          }),
        ],
      });

      const page = await service.billingList(service.resolveMonth('2026-10'), {
        page: 1,
        pageSize: 20,
      });

      expect(page.items.map((item) => [item.status, item.paidAt])).toEqual([
        ['paid', PAID_AT.toISOString()],
        ['pending', null],
        ['pending', null],
      ]);
      expect(page.totals).toEqual({
        checkIns: 9,
        amountCop: 18000,
        paidCop: 4000,
        pendingCop: 2000,
      });
    });
  });

  describe('billingDetail', () => {
    it('404 RESTAURANT_NOT_FOUND for a restaurant that does not exist', async () => {
      const { service } = createService({ header: false });

      expect(
        await errorOf(
          service.billingDetail(
            RESTAURANT_ID,
            service.resolveMonth('2026-10'),
            {
              page: 1,
              pageSize: 50,
            },
          ),
        ),
      ).toMatchObject({ statusCode: 404, errorCode: 'RESTAURANT_NOT_FOUND' });
    });

    it('a paid month with the same numbers: snapshot and no mismatch', async () => {
      const { service } = createService({
        period: {
          status: 'paid',
          amountCopSnapshot: 6000,
          checkInsSnapshot: 3,
          markedPaidAt: PAID_AT,
        },
      });

      const detail = await service.billingDetail(
        RESTAURANT_ID,
        service.resolveMonth('2026-10'),
        { page: 1, pageSize: 50 },
      );

      expect(detail).toMatchObject({
        status: 'paid',
        paidAt: PAID_AT.toISOString(),
        snapshot: { amountCop: 6000, checkIns: 3 },
        amountMismatch: false,
        totalCheckIns: 3,
        amountCop: 6000,
      });
    });

    it('a paid month whose recalculated amount differs: both values and amountMismatch, never corrected', async () => {
      const { service } = createService({
        period: {
          status: 'paid',
          amountCopSnapshot: 4000,
          checkInsSnapshot: 2,
          markedPaidAt: PAID_AT,
        },
      });

      const detail = await service.billingDetail(
        RESTAURANT_ID,
        service.resolveMonth('2026-10'),
        { page: 1, pageSize: 50 },
      );

      expect(detail).toMatchObject({
        amountCop: 6000,
        snapshot: { amountCop: 4000, checkIns: 2 },
        amountMismatch: true,
      });
    });

    it('the items carry only business data: no reservation, no table', async () => {
      const { service } = createService();

      const detail = await service.billingDetail(
        RESTAURANT_ID,
        service.resolveMonth('2026-10'),
        { page: 1, pageSize: 50 },
      );

      expect(detail.status).toBe('pending');
      expect(detail.snapshot).toBeNull();
      expect(detail.items).toEqual([
        {
          checkInId: 'c-1',
          checkedInAt: '2026-10-14T22:05:00.000Z',
          partySize: 4,
          feeCop: 2000,
        },
      ]);
    });
  });

  describe('platformMetrics', () => {
    it('expires every due reservation before counting', async () => {
      const { service, order } = createService();

      const metrics = await service.platformMetrics({});

      expect(order).toEqual(['expire', 'metrics']);
      expect(metrics.basis).toBe('reservations_created_at');
      // Los dos desgloses nuevos pasan tal cual y no cambian los de siempre.
      expect(metrics.byDate).toEqual([{ date: '2026-11-01', reservations: 0 }]);
      expect(metrics.byDayHour).toEqual([
        { dayOfWeek: 1, hour: 0, reservations: 0 },
      ]);
      expect(metrics.period).toEqual({
        from: '2026-11-01',
        to: '2026-11-17',
        timezone: 'America/Bogota',
      });
    });

    it('400 for an invalid period, without expiring anything', async () => {
      const { service, expiration } = createService();

      expect(
        await errorOf(
          service.platformMetrics({ from: '2026-11-10', to: '2026-11-01' }),
        ),
      ).toMatchObject({
        statusCode: 400,
        message: [REPORT_PERIOD_MESSAGES.FROM_AFTER_TO],
      });
      expect(expiration.expireAllDue).not.toHaveBeenCalled();
    });
  });
});
