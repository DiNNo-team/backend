import { HttpException } from '@nestjs/common';
import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import {
  parseBillingMonth,
  type BillingMonth,
} from '../../src/modules/reservations-checkin/billing/billing-month.js';
import { BillingPeriodsService } from '../../src/modules/reservations-checkin/billing/billing-periods.service.js';
import { BillingStatementService } from '../../src/modules/reservations-checkin/billing/billing-statement.service.js';
import { PlatformBillingReader } from '../../src/modules/reservations-checkin/platform/platform-billing.reader.js';
import { AdminFixtures } from './support/admin-fixtures.js';
import { closeTestDataSource, openTestDataSource } from './support/scenario.js';
import {
  CHECK_VIOLATION,
  connectTestDatabase,
  expectDatabaseError,
  inRolledBackTransaction,
} from './support/test-db.js';

// Cobro de la plataforma (panel del administrador) contra Postgres REAL: el
// dinero es SUM(check_ins.fee_cop) por mes de Bogotá, y marcar un mes como
// cobrado es seguro ante la concurrencia. Usa marzo y abril de 2026 (meses
// cerrados) y compara las sumas de toda la plataforma por diferencia: la base
// de pruebas es una copia de datos reales.

// 2026-11-17 10:00 en Bogotá: marzo y abril están cerrados.
const NOW = new Date('2026-11-17T15:00:00Z');
const ROUNDS = 8;

function month(key: string): BillingMonth {
  const result = parseBillingMonth(key, NOW);
  if (!result.ok) throw new Error(key);
  return result.month;
}

// Instantes de Bogotá (UTC-5) escritos como hora local de Bogotá.
const bogota = (local: string) => new Date(`${local}-05:00`);

describe('Cobro de la plataforma (Postgres)', () => {
  let client: Client;
  let dataSource: DataSource;
  let fixtures: AdminFixtures;
  let reader: PlatformBillingReader;
  let billing: BillingStatementService;
  let periods: BillingPeriodsService;

  beforeAll(async () => {
    client = await connectTestDatabase();
    dataSource = await openTestDataSource();
    fixtures = new AdminFixtures(client);
    reader = new PlatformBillingReader(dataSource);
    billing = new BillingStatementService(dataSource);
    periods = new BillingPeriodsService(dataSource, reader, billing, {
      now: () => NOW,
    });
  });

  afterAll(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await closeTestDataSource(dataSource);
      await client.end();
    }
  });

  it('suma la tarifa guardada en cada check-in: fee_cop distintos en el mismo mes', async () => {
    const before = await billing.platformTotals(month('2026-03').period);
    const restaurant = await fixtures.restaurant();
    // Tres tarifas distintas: la tarifa cambió a mitad de mes.
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-05T12:00:00'),
      2000,
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-12T19:30:00'),
      1500,
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-20T13:00:00'),
      2500,
    );

    expect(await billing.totals(restaurant, month('2026-03').period)).toEqual({
      checkIns: 3,
      amountCop: 6000,
    });
    const after = await billing.platformTotals(month('2026-03').period);
    expect(after.amountCop - before.amountCop).toBe(6000);
    expect(after.checkIns - before.checkIns).toBe(3);
  });

  it('cuenta los meses en hora de Bogotá: 23:30 del último día y 00:10 del día 1', async () => {
    const restaurant = await fixtures.restaurant();
    const series = async () =>
      new Map(
        (await reader.monthlyTotals('2026-03', '2026-04')).map((row) => [
          row.month,
          row,
        ]),
      );
    const before = await series();
    // 2026-03-31 23:30 en Bogotá = 2026-04-01 04:30 UTC: es marzo.
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-31T23:30:00'),
      2000,
    );
    // 2026-04-01 00:10 en Bogotá = 2026-04-01 05:10 UTC: es abril.
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-04-01T00:10:00'),
      3000,
    );

    expect(await billing.totals(restaurant, month('2026-03').period)).toEqual({
      checkIns: 1,
      amountCop: 2000,
    });
    expect(await billing.totals(restaurant, month('2026-04').period)).toEqual({
      checkIns: 1,
      amountCop: 3000,
    });
    const after = await series();
    expect(
      (after.get('2026-03')?.revenueCop ?? 0) -
        (before.get('2026-03')?.revenueCop ?? 0),
    ).toBe(2000);
    expect(
      (after.get('2026-04')?.revenueCop ?? 0) -
        (before.get('2026-04')?.revenueCop ?? 0),
    ).toBe(3000);
  });

  it('las cancelaciones y los vencimientos no se cobran', async () => {
    const restaurant = await fixtures.restaurant();
    await fixtures.reservation(
      restaurant,
      'cancelled',
      bogota('2026-03-10T12:00:00'),
    );
    await fixtures.reservation(
      restaurant,
      'expired',
      bogota('2026-03-11T12:00:00'),
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-12T12:00:00'),
      2000,
    );

    expect(await billing.totals(restaurant, month('2026-03').period)).toEqual({
      checkIns: 1,
      amountCop: 2000,
    });
  });

  it('incluye los meses en 0 en la serie y los restaurantes sin check-ins en la lista', async () => {
    const series = await reader.monthlyTotals('2026-01', '2026-04');
    expect(series.map((row) => row.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);

    const quiet = await fixtures.restaurant();
    const all: string[] = [];
    for (let page = 1; ; page += 1) {
      const { rows, total } = await reader.billingPage(
        month('2026-03'),
        page,
        100,
      );
      all.push(...rows.map((row) => row.restaurantId));
      const mine = rows.find((row) => row.restaurantId === quiet);
      if (mine) {
        expect(mine).toMatchObject({
          checkIns: 0,
          amountCop: 0,
          periodStatus: null,
        });
      }
      if (page * 100 >= total) break;
    }
    expect(all).toContain(quiet);
  });

  it('la lista incluye suspendidos y no incluye pendientes', async () => {
    const suspended = await fixtures.restaurant('suspended');
    const pending = await fixtures.restaurant('pending');
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const { rows, total } = await reader.billingPage(
        month('2026-03'),
        page,
        100,
      );
      ids.push(...rows.map((row) => row.restaurantId));
      if (page * 100 >= total) break;
    }
    expect(ids).toContain(suspended);
    expect(ids).not.toContain(pending);
  });

  it('marcar como cobrado guarda el snapshot y mueve el dinero de pendiente a cobrado', async () => {
    const restaurant = await fixtures.restaurant();
    const admin = await fixtures.admin();
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-04-02T12:00:00'),
      2000,
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-04-03T12:00:00'),
      1500,
    );
    const collectedBefore = await reader.collectedCop('2026-11');
    const pendingBefore = await reader.pendingCop('2026-01', '2026-11');

    await periods.markPaid(admin, restaurant, month('2026-04'));

    const { rows } = await client.query<{
      status: string;
      amount_cop_snapshot: number;
      check_ins_snapshot: number;
      marked_paid_by: string;
      period_month: string;
    }>(
      `SELECT status, amount_cop_snapshot, check_ins_snapshot, marked_paid_by, to_char(period_month, 'YYYY-MM-DD') AS period_month
       FROM billing_periods WHERE restaurant_id = $1`,
      [restaurant],
    );
    expect(rows).toEqual([
      {
        status: 'paid',
        amount_cop_snapshot: 3500,
        check_ins_snapshot: 2,
        marked_paid_by: admin,
        period_month: '2026-04-01',
      },
    ]);
    expect((await reader.collectedCop('2026-11')) - collectedBefore).toBe(3500);
    expect(
      pendingBefore - (await reader.pendingCop('2026-01', '2026-11')),
    ).toBe(3500);

    await periods.markPending(restaurant, month('2026-04'));
    const { rows: undone } = await client.query(
      `SELECT status, amount_cop_snapshot, check_ins_snapshot, marked_paid_at, marked_paid_by
       FROM billing_periods WHERE restaurant_id = $1`,
      [restaurant],
    );
    expect(undone).toEqual([
      {
        status: 'pending',
        amount_cop_snapshot: null,
        check_ins_snapshot: null,
        marked_paid_at: null,
        marked_paid_by: null,
      },
    ]);
    expect(await reader.collectedCop('2026-11')).toBe(collectedBefore);
  });

  it('dos marcas a la vez: una gana y la otra recibe 409 PERIOD_ALREADY_PAID', async () => {
    const tally = [0, 0];
    for (let round = 0; round < ROUNDS; round += 1) {
      const restaurant = await fixtures.restaurant();
      const admins = [await fixtures.admin(), await fixtures.admin()];
      await fixtures.reservation(
        restaurant,
        'completed',
        bogota('2026-04-10T12:00:00'),
        2000,
      );

      const results = await Promise.allSettled(
        admins.map((admin) =>
          periods.markPaid(admin, restaurant, month('2026-04')),
        ),
      );

      const won = results.flatMap((result, index) =>
        result.status === 'fulfilled' ? [index] : [],
      );
      expect(won).toHaveLength(1);
      tally[won[0]] += 1;
      const loser = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(loser?.reason).toBeInstanceOf(HttpException);
      expect((loser!.reason as HttpException).getResponse()).toMatchObject({
        statusCode: 409,
        errorCode: 'PERIOD_ALREADY_PAID',
      });
      const { rows } = await client.query<{
        count: number;
        marked_paid_by: string;
      }>(
        `SELECT count(*) OVER ()::int AS count, marked_paid_by FROM billing_periods WHERE restaurant_id = $1`,
        [restaurant],
      );
      expect(rows).toEqual([{ count: 1, marked_paid_by: admins[won[0]] }]);
    }
    process.stdout.write(
      `[dos marcas de cobrado] ${ROUNDS} rondas: ganó la primera=${tally[0]} la segunda=${tally[1]}\n`,
    );
  });

  it('la base exige el snapshot de un mes cobrado y el día 1 del mes', async () => {
    const restaurant = await fixtures.restaurant();
    await inRolledBackTransaction(client, async () => {
      const paidWithoutSnapshot = await expectDatabaseError(
        client,
        `INSERT INTO billing_periods (restaurant_id, period_month, status) VALUES ($1, '2026-04-01', 'paid')`,
        [restaurant],
      );
      expect(paidWithoutSnapshot).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'CHK_billing_periods_paid_fields',
      });
      const notFirstDay = await expectDatabaseError(
        client,
        `INSERT INTO billing_periods (restaurant_id, period_month, status) VALUES ($1, '2026-04-15', 'pending')`,
        [restaurant],
      );
      expect(notFirstDay).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'CHK_billing_periods_month_first_day',
      });
    });
  });

  it('las consultas de la plataforma usan los índices nuevos por fecha', async () => {
    const { rows } = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
         AND indexname IN ('IDX_check_ins_checked_in_at', 'IDX_reservations_created_at')
       ORDER BY indexname`,
    );
    expect(rows.map((row) => row.indexname)).toEqual([
      'IDX_check_ins_checked_in_at',
      'IDX_reservations_created_at',
    ]);
  });
});
