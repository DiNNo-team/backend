import type { DataSource } from 'typeorm';
import type { BillingStatementService } from '../billing/billing-statement.service.js';
import { parseReportPeriod, type ReportPeriod } from './report-period.js';
import { RestaurantMetricsService } from './restaurant-metrics.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

function period(): ReportPeriod {
  const result = parseReportPeriod(
    { from: '2026-11-01', to: '2026-11-15' },
    new Date('2026-11-15T14:30:00Z'),
  );
  if (!result.ok) throw new Error(result.errors.join());
  return result.period;
}

interface Answers {
  counts: object;
  hours: object[];
  days: object[];
}

function createService(answers: Answers) {
  const query = vi.fn((sql: string, _params: unknown[]) => {
    if (sql.includes('FILTER')) return Promise.resolve([answers.counts]);
    if (sql.includes('EXTRACT(HOUR')) return Promise.resolve(answers.hours);
    if (sql.includes('EXTRACT(ISODOW')) return Promise.resolve(answers.days);
    throw new Error(`Consulta no simulada: ${sql}`);
  });
  const billing = {
    totals: vi.fn().mockResolvedValue({ checkIns: 4, amountCop: 9500 }),
    platformTotals: vi
      .fn()
      .mockResolvedValue({ checkIns: 9, amountCop: 18000 }),
  };
  const service = new RestaurantMetricsService(
    { query } as unknown as DataSource,
    billing as unknown as BillingStatementService,
  );
  return { service, query, billing };
}

const EMPTY: Answers = {
  counts: {
    created: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    active: 0,
    average_party_size: null,
  },
  hours: [],
  days: [],
};

describe('RestaurantMetricsService', () => {
  it('turns the SQL counts into the summary numbers', async () => {
    const { service, billing } = createService({
      counts: {
        created: 10,
        completed: 4,
        cancelled: 3,
        expired: 2,
        active: 1,
        average_party_size: 2.6666666,
      },
      hours: [
        { hour: 20, reservations: 3 },
        { hour: 13, reservations: 3 },
        { hour: 12, reservations: 4 },
        { hour: 9, reservations: 0 },
      ],
      days: [
        { dayOfWeek: 7, reservations: 6 },
        { dayOfWeek: 1, reservations: 4 },
      ],
    });

    const metrics = await service.forRestaurant(RESTAURANT_ID, period());

    expect(metrics).toEqual({
      billing: { checkIns: 4, amountCop: 9500 },
      reservations: {
        created: 10,
        completed: 4,
        cancelled: 3,
        expired: 2,
        active: 1,
      },
      rates: { conversion: 0.4, noShow: 0.3333, cancellation: 0.3 },
      averagePartySize: 2.67,
      peakHours: [
        { hour: 12, reservations: 4 },
        { hour: 13, reservations: 3 },
        { hour: 20, reservations: 3 },
      ],
      byDayOfWeek: [
        { dayOfWeek: 1, reservations: 4 },
        { dayOfWeek: 2, reservations: 0 },
        { dayOfWeek: 3, reservations: 0 },
        { dayOfWeek: 4, reservations: 0 },
        { dayOfWeek: 5, reservations: 0 },
        { dayOfWeek: 6, reservations: 0 },
        { dayOfWeek: 7, reservations: 6 },
      ],
    });
    expect(billing.totals).toHaveBeenCalledWith(RESTAURANT_ID, period());
  });

  it('a restaurant without data: zeros, nulls and empty lists', async () => {
    const { service } = createService(EMPTY);

    const metrics = await service.forRestaurant(RESTAURANT_ID, period());

    expect(metrics.reservations).toEqual({
      created: 0,
      completed: 0,
      cancelled: 0,
      expired: 0,
      active: 0,
    });
    expect(metrics.rates).toEqual({
      conversion: null,
      noShow: null,
      cancellation: null,
    });
    expect(metrics.averagePartySize).toBeNull();
    expect(metrics.peakHours).toEqual([]);
    expect(metrics.byDayOfWeek).toHaveLength(7);
  });

  it('every reservation query filters by the restaurant and the UTC bounds of the Bogotá period, and groups in Bogotá', async () => {
    const { service, query } = createService(EMPTY);

    await service.forRestaurant(RESTAURANT_ID, period());

    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of query.mock.calls) {
      expect(params).toEqual([
        RESTAURANT_ID,
        new Date('2026-11-01T05:00:00Z'),
        new Date('2026-11-16T05:00:00Z'),
      ]);
      expect(sql).toContain('"created_at" >= $2 AND "created_at" < $3');
    }
    const grouped = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('GROUP BY'));
    expect(grouped).toHaveLength(2);
    for (const sql of grouped) {
      expect(sql).toContain(`AT TIME ZONE 'America/Bogota'`);
    }
  });

  describe('forPlatform (panel del administrador)', () => {
    it('uses the same queries without the restaurant filter, and the platform totals', async () => {
      const { service, query, billing } = createService({
        ...EMPTY,
        hours: [{ hour: 13, reservations: 3 }],
        days: [{ dayOfWeek: 5, reservations: 3 }],
      });

      const metrics = await service.forPlatform(period());

      expect(billing.platformTotals).toHaveBeenCalledWith(period());
      expect(billing.totals).not.toHaveBeenCalled();
      expect(metrics.billing).toEqual({ checkIns: 9, amountCop: 18000 });
      for (const [sql, params] of query.mock.calls) {
        expect(sql).not.toContain('restaurant_id');
        expect(sql).toContain('"created_at" >= $1 AND "created_at" < $2');
        expect(params).toEqual([period().startsAt, period().endsBefore]);
      }
    });

    it('returns the 24-hour distribution instead of the top 3', async () => {
      const { service } = createService({
        ...EMPTY,
        hours: [
          { hour: 13, reservations: 3 },
          { hour: 19, reservations: 2 },
          { hour: 12, reservations: 2 },
          { hour: 20, reservations: 1 },
        ],
      });

      const metrics = await service.forPlatform(period());

      expect(metrics.hourly).toHaveLength(24);
      expect(metrics.hourly[20]).toEqual({ hour: 20, reservations: 1 });
      expect(metrics).not.toHaveProperty('peakHours');
    });

    it('forRestaurant keeps its top 3 and its restaurant filter', async () => {
      const { service, query, billing } = createService(EMPTY);

      const metrics = await service.forRestaurant(RESTAURANT_ID, period());

      expect(metrics.peakHours).toEqual([]);
      expect(metrics).not.toHaveProperty('hourly');
      expect(billing.platformTotals).not.toHaveBeenCalled();
      for (const [sql] of query.mock.calls) {
        expect(sql).toContain('"restaurant_id" = $1');
      }
    });
  });
});
