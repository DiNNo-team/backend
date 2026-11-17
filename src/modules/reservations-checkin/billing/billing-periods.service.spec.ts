import { HttpException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { Clock } from '../../search-availability/index.js';
import type { PlatformBillingReader } from '../platform/platform-billing.reader.js';
import { BILLING_ERRORS, type BillingErrorCode } from './billing-errors.js';
import { parseBillingMonth, type BillingMonth } from './billing-month.js';
import { BillingPeriodsService } from './billing-periods.service.js';
import type { BillingStatementService } from './billing-statement.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const ADMIN_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3';
// 2026-11-17 10:00 en Bogotá.
const NOW = new Date('2026-11-17T15:00:00Z');

function month(key: string): BillingMonth {
  const result = parseBillingMonth(key, NOW);
  if (!result.ok) throw new Error(key);
  return result.month;
}

function createService({
  exists = true,
  checkIns = 3,
  amountCop = 5500,
  upsertRows = [{ id: 'bp-1' }] as unknown[],
  affected = 1,
} = {}) {
  const query = vi.fn((sql: string) =>
    Promise.resolve(sql.startsWith('INSERT') ? upsertRows : [[], affected]),
  );
  const reader = {
    restaurantHeader: vi.fn(() =>
      Promise.resolve(
        exists
          ? { id: RESTAURANT_ID, name: 'Casa 72', approvalStatus: 'approved' }
          : null,
      ),
    ),
  };
  const billing = {
    totals: vi.fn(() => Promise.resolve({ checkIns, amountCop })),
  };
  const clock: Clock = { now: () => NOW };
  const service = new BillingPeriodsService(
    { query } as unknown as DataSource,
    reader as unknown as PlatformBillingReader,
    billing as unknown as BillingStatementService,
    clock,
  );
  return { service, query, billing };
}

async function conflictOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as {
    statusCode: number;
    errorCode?: string;
    message: string;
  };
}

function expectConflict(
  body: { statusCode: number; errorCode?: string; message: string },
  code: BillingErrorCode,
) {
  expect(body).toEqual({
    statusCode: 409,
    message: BILLING_ERRORS[code],
    error: 'Conflict',
    errorCode: code,
  });
}

describe('BillingPeriodsService.markPaid', () => {
  it('saves the snapshot of SUM(fee_cop), who and when, with a conditional UPSERT', async () => {
    const { service, query, billing } = createService();

    await service.markPaid(ADMIN_ID, RESTAURANT_ID, month('2026-10'));

    expect(billing.totals).toHaveBeenCalledWith(
      RESTAURANT_ID,
      month('2026-10').period,
    );
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(
      'ON CONFLICT ON CONSTRAINT "UQ_billing_periods_restaurant_id_period_month" DO UPDATE',
    );
    expect(sql).toContain(`WHERE "billing_periods"."status" = 'pending'`);
    expect(params).toEqual([
      RESTAURANT_ID,
      '2026-10-01',
      5500,
      3,
      NOW,
      ADMIN_ID,
    ]);
  });

  it('404 for a restaurant that does not exist, before anything else', async () => {
    const { service, query } = createService({ exists: false });

    const body = await conflictOf(
      service.markPaid(ADMIN_ID, RESTAURANT_ID, month('2026-11')),
    );

    expect(body).toMatchObject({
      statusCode: 404,
      errorCode: 'RESTAURANT_NOT_FOUND',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('409 PERIOD_NOT_CLOSED for the month in progress', async () => {
    const { service, query } = createService();

    expectConflict(
      await conflictOf(
        service.markPaid(ADMIN_ID, RESTAURANT_ID, month('2026-11')),
      ),
      'PERIOD_NOT_CLOSED',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('409 NOTHING_TO_BILL for a closed month without check-ins', async () => {
    const { service, query } = createService({ checkIns: 0, amountCop: 0 });

    expectConflict(
      await conflictOf(
        service.markPaid(ADMIN_ID, RESTAURANT_ID, month('2026-10')),
      ),
      'NOTHING_TO_BILL',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('409 PERIOD_ALREADY_PAID when the UPSERT updates nothing (already paid, or another admin won)', async () => {
    const { service } = createService({ upsertRows: [] });

    expectConflict(
      await conflictOf(
        service.markPaid(ADMIN_ID, RESTAURANT_ID, month('2026-10')),
      ),
      'PERIOD_ALREADY_PAID',
    );
  });
});

describe('BillingPeriodsService.markPending', () => {
  it('goes back to pending and clears the snapshot, only from paid', async () => {
    const { service, query } = createService();

    await service.markPending(RESTAURANT_ID, month('2026-10'));

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(`"amount_cop_snapshot" = NULL`);
    expect(sql).toContain(`"marked_paid_by" = NULL`);
    expect(sql).toContain(`AND "status" = 'paid'`);
    expect(params).toEqual([RESTAURANT_ID, '2026-10-01']);
  });

  it('409 PERIOD_NOT_PAID when nothing was paid (no row, pending or the month in progress)', async () => {
    const { service } = createService({ affected: 0 });

    expectConflict(
      await conflictOf(service.markPending(RESTAURANT_ID, month('2026-11'))),
      'PERIOD_NOT_PAID',
    );
  });

  it('404 for a restaurant that does not exist', async () => {
    const { service } = createService({ exists: false });

    expect(
      await conflictOf(service.markPending(RESTAURANT_ID, month('2026-10'))),
    ).toMatchObject({ statusCode: 404, errorCode: 'RESTAURANT_NOT_FOUND' });
  });
});
