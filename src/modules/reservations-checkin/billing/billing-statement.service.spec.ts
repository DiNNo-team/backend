import type { DataSource } from 'typeorm';
import {
  parseReportPeriod,
  type ReportPeriod,
} from '../reports/report-period.js';
import { BillingStatementService } from './billing-statement.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

function periodOf(from: string, to: string): ReportPeriod {
  const result = parseReportPeriod(
    { from, to },
    new Date('2026-12-31T12:00:00Z'),
  );
  if (!result.ok) throw new Error(result.errors.join());
  return result.period;
}

function createService(totals: object, rows: object[]) {
  const query = vi.fn((sql: string, _params: unknown[]) =>
    Promise.resolve(sql.includes('SUM("fee_cop")') ? [totals] : rows),
  );
  const service = new BillingStatementService({
    query,
  } as unknown as DataSource);
  return { service, query };
}

describe('BillingStatementService', () => {
  it('totals: counts the check-ins and adds the stored fee of each one (bigint text to number)', async () => {
    const { service, query } = createService(
      { check_ins: 3, amount_cop: '7500' },
      [],
    );

    expect(
      await service.totals(RESTAURANT_ID, periodOf('2026-11-01', '2026-11-30')),
    ).toEqual({ checkIns: 3, amountCop: 7500 });
    const [sql, params] = query.mock.calls[0];
    // Suma la tarifa guardada, nunca la vigente.
    expect(sql).toContain('COALESCE(SUM("fee_cop"), 0)');
    expect(params).toEqual([
      RESTAURANT_ID,
      new Date('2026-11-01T05:00:00Z'),
      new Date('2026-12-01T05:00:00Z'),
    ]);
  });

  it('totals of a period without check-ins is zero', async () => {
    const { service } = createService({ check_ins: 0, amount_cop: '0' }, []);

    expect(
      await service.totals(RESTAURANT_ID, periodOf('2026-11-01', '2026-11-01')),
    ).toEqual({ checkIns: 0, amountCop: 0 });
  });

  it('statement: totals of the whole period plus one page, newest first, with each stored fee', async () => {
    const { service, query } = createService(
      { check_ins: 2, amount_cop: '5500' },
      [
        {
          check_in_id: 'c2',
          reservation_id: 'r2',
          checked_in_at: new Date('2026-11-20T15:00:00Z'),
          fee_cop: 3500,
          party_size: 4,
          table_identifier: '04',
        },
        {
          check_in_id: 'c1',
          reservation_id: 'r1',
          checked_in_at: new Date('2026-11-10T15:00:00Z'),
          fee_cop: 2000,
          party_size: 2,
          table_identifier: 'T1',
        },
      ],
    );

    const statement = await service.statement(
      RESTAURANT_ID,
      periodOf('2026-11-01', '2026-11-30'),
      { page: 2, pageSize: 25 },
    );

    expect(statement).toEqual({
      totalCheckIns: 2,
      amountCop: 5500,
      items: [
        {
          checkInId: 'c2',
          reservationId: 'r2',
          checkedInAt: '2026-11-20T15:00:00.000Z',
          partySize: 4,
          tableIdentifier: '04',
          feeCop: 3500,
        },
        {
          checkInId: 'c1',
          reservationId: 'r1',
          checkedInAt: '2026-11-10T15:00:00.000Z',
          partySize: 2,
          tableIdentifier: 'T1',
          feeCop: 2000,
        },
      ],
    });
    const page = query.mock.calls.find(([sql]) => sql.includes('LIMIT'));
    expect(page?.[1]).toEqual([
      RESTAURANT_ID,
      new Date('2026-11-01T05:00:00Z'),
      new Date('2026-12-01T05:00:00Z'),
      25,
      25,
    ]);
    // Nunca datos del comensal.
    expect(page?.[0]).not.toMatch(/diner|users|display_name|email/);
  });
});
