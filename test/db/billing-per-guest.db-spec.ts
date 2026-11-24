import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { User } from '../../src/modules/identity-access/users/user.entity.js';
import { UsersService } from '../../src/modules/identity-access/users/users.service.js';
import {
  parseBillingMonth,
  type BillingMonth,
} from '../../src/modules/reservations-checkin/billing/billing-month.js';
import { BillingPeriodsService } from '../../src/modules/reservations-checkin/billing/billing-periods.service.js';
import { BillingStatementService } from '../../src/modules/reservations-checkin/billing/billing-statement.service.js';
import type { CheckInFeeConfig } from '../../src/modules/reservations-checkin/billing/checkin-fee.config.js';
import { CheckInService } from '../../src/modules/reservations-checkin/check-ins/check-in.service.js';
import { ReservationLabelsReader } from '../../src/modules/reservations-checkin/check-ins/reservation-labels.reader.js';
import { PlatformBillingReader } from '../../src/modules/reservations-checkin/platform/platform-billing.reader.js';
import { PlatformReportsService } from '../../src/modules/reservations-checkin/platform/platform-reports.service.js';
import { RestaurantSummaryReader } from '../../src/modules/reservations-checkin/reports/restaurant-summary.reader.js';
import { parseReportPeriod } from '../../src/modules/reservations-checkin/reports/report-period.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import type { Clock } from '../../src/modules/search-availability/index.js';
import { AdminFixtures } from './support/admin-fixtures.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario,
} from './support/scenario.js';
import { insertAdmin, insertReservation } from './support/script-data.js';
import { connectTestDatabase } from './support/test-db.js';

// Cobro por comensal (CLAUDE.md §11, "Cobro por check-in") contra Postgres REAL:
// el check-in guarda personas × tarifa por comensal en check_ins.fee_cop, y lo
// histórico (check-ins y meses ya cobrados con el cobro fijo anterior) se suma
// tal cual, sin recalcularse. Commits reales: cada prueba borra solo lo que creó.

const PER_GUEST_COP = 1500;
// 2026-11-17 10:00 en Bogotá: marzo y abril de 2026 son meses cerrados.
const NOW = new Date('2026-11-17T15:00:00Z');
const bogota = (local: string) => new Date(`${local}-05:00`);
const CLOCK: Clock = { now: () => new Date() };

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

function checkInService(): CheckInService {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  return new CheckInService(
    dataSource,
    new ReservationExpirationService(dataSource, statusLog, events, CLOCK),
    statusLog,
    new ReservationLabelsReader(
      dataSource,
      new UsersService(dataSource.getRepository(User)),
    ),
    CLOCK,
    events,
    { feePerGuestCop: PER_GUEST_COP },
  );
}

function month(key: string): BillingMonth {
  const result = parseBillingMonth(key, NOW);
  if (!result.ok) throw new Error(key);
  return result.month;
}

describe('Cobro por comensal: check-in real (Postgres)', () => {
  it('fee_cop = personas × tarifa para 1, 2, 4, 5 y 20 personas; cancelar o vencer no cobra', async () => {
    const sizes = [1, 2, 4, 5, 20];
    await withScenario(
      dataSource,
      sizes.map((capacity, index) => ({
        identifier: `0${index + 1}`,
        capacity: Math.max(capacity, 2),
      })),
      sizes.length + 1,
      async (scenario) => {
        const admin = await insertAdmin(dataSource, scenario);
        const user = {
          userId: admin.id,
          restaurantId: scenario.restaurantId,
          role: UserRole.RESTAURANT_ADMIN,
          restaurantApproval: 'approved' as const,
        };
        const checkedIn = [];
        for (const [index, partySize] of sizes.entries()) {
          checkedIn.push(
            await insertReservation(dataSource, scenario, {
              dinerId: scenario.dinerIds[index],
              tableId: scenario.tableIds.get(`0${index + 1}`) as string,
              state: 'active',
              partySize,
            }),
          );
        }
        // Una cancelada y una vencida de 4 personas: no generan cobro.
        const noCharge = [
          await insertReservation(dataSource, scenario, {
            dinerId: scenario.dinerIds[sizes.length],
            tableId: scenario.tableIds.get('03') as string,
            state: 'cancelled',
            partySize: 4,
          }),
          await insertReservation(dataSource, scenario, {
            dinerId: scenario.dinerIds[sizes.length],
            tableId: scenario.tableIds.get('03') as string,
            state: 'expired',
            partySize: 4,
          }),
        ];

        for (const reservation of checkedIn) {
          await checkInService().checkIn(user, reservation.code);
        }

        const stored = await dataSource.query<
          { reservation_id: string; party_size: number; fee_cop: number }[]
        >(
          `SELECT c.reservation_id, r.party_size, c.fee_cop
             FROM check_ins c JOIN reservations r ON r.id = c.reservation_id
            WHERE c.restaurant_id = $1 ORDER BY r.party_size`,
          [scenario.restaurantId],
        );
        expect(stored.map((row) => [row.party_size, row.fee_cop])).toEqual([
          [1, 1500],
          [2, 3000],
          [4, 6000],
          [5, 7500],
          [20, 30000],
        ]);
        const charged = await dataSource.query(
          `SELECT 1 FROM check_ins WHERE reservation_id = ANY($1::uuid[])`,
          [noCharge.map((reservation) => reservation.id)],
        );
        expect(charged).toEqual([]);

        const period = parseReportPeriod({}, new Date());
        if (!period.ok) throw new Error(period.errors.join());
        const billing = new BillingStatementService(dataSource);
        expect(
          await billing.totals(scenario.restaurantId, period.period),
        ).toEqual({ checkIns: 5, amountCop: 48000 });
        const statement = await billing.statement(
          scenario.restaurantId,
          period.period,
          { page: 1, pageSize: 50 },
        );
        expect(
          statement.items
            .map((item) => [item.partySize, item.feeCop])
            .sort((a, b) => a[0] - b[0]),
        ).toEqual([
          [1, 1500],
          [2, 3000],
          [4, 6000],
          [5, 7500],
          [20, 30000],
        ]);
        // Resumen: comensales y monto del mismo periodo, con la misma suma.
        const summary = await new RestaurantSummaryReader(dataSource).totals(
          scenario.restaurantId,
          period.period,
        );
        expect(summary).toMatchObject({
          checkIns: 5,
          guests: 32,
          amountCop: 48000,
        });
      },
    );
  });
});

describe('Cobro por comensal: histórico mezclado con check-ins nuevos (Postgres)', () => {
  let client: Client;
  let fixtures: AdminFixtures;
  let reader: PlatformBillingReader;
  let billing: BillingStatementService;
  let periods: BillingPeriodsService;
  let reports: PlatformReportsService;

  beforeAll(async () => {
    client = await connectTestDatabase();
    fixtures = new AdminFixtures(client);
    reader = new PlatformBillingReader(dataSource);
    billing = new BillingStatementService(dataSource);
    periods = new BillingPeriodsService(dataSource, reader, billing, {
      now: () => NOW,
    });
    reports = new PlatformReportsService(
      reader,
      billing,
      null as never,
      null as never,
      { feePerGuestCop: PER_GUEST_COP } as CheckInFeeConfig,
      { now: () => NOW },
    );
  });

  afterAll(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await client.end();
    }
  });

  it('suma lo guardado: filas antiguas (cobro fijo) y nuevas (por persona) en el mismo mes, sin recalcular', async () => {
    const restaurant = await fixtures.restaurant();
    const before = await billing.platformTotals(month('2026-03').period);
    // Antiguas: 2000 fijos con 4 y con 1 persona (no son personas × 1500).
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-04T12:00:00'),
      2000,
      4,
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-05T12:00:00'),
      2000,
      1,
    );
    // Nuevas: personas × 1500.
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-20T12:00:00'),
      3000,
      2,
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-03-21T12:00:00'),
      7500,
      5,
    );
    // Canceladas y vencidas no cobran.
    await fixtures.reservation(
      restaurant,
      'cancelled',
      bogota('2026-03-22T12:00:00'),
      0,
      4,
    );
    await fixtures.reservation(
      restaurant,
      'expired',
      bogota('2026-03-23T12:00:00'),
      0,
      4,
    );

    const march = month('2026-03').period;
    expect(await billing.totals(restaurant, march)).toEqual({
      checkIns: 4,
      amountCop: 14500,
    });
    const items = (
      await billing.statement(restaurant, march, { page: 1, pageSize: 50 })
    ).items;
    expect(items.map((item) => [item.partySize, item.feeCop])).toEqual([
      [5, 7500],
      [2, 3000],
      [1, 2000],
      [4, 2000],
    ]);
    const after = await billing.platformTotals(march);
    expect(after.amountCop - before.amountCop).toBe(14500);
    expect(after.checkIns - before.checkIns).toBe(4);
    const summary = await new RestaurantSummaryReader(dataSource).totals(
      restaurant,
      march,
    );
    expect(summary).toMatchObject({
      checkIns: 4,
      guests: 12,
      amountCop: 14500,
    });
  });

  it('un mes cobrado conserva su snapshot y no marca amountMismatch; el mes con check-ins nuevos queda pendiente por su suma', async () => {
    const restaurant = await fixtures.restaurant();
    const admin = await fixtures.admin();
    // Abril: histórico con cobro fijo, marcado como cobrado.
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-04-02T12:00:00'),
      2000,
      4,
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2026-04-03T12:00:00'),
      2000,
      2,
    );
    await periods.markPaid(admin, restaurant, month('2026-04'));
    // Octubre: check-ins por persona (1, 2, 4 y 5 personas), sin cobrar todavía.
    for (const [day, partySize] of [
      [5, 1],
      [6, 2],
      [7, 4],
      [8, 5],
    ] as const) {
      await fixtures.reservation(
        restaurant,
        'completed',
        bogota(`2026-10-0${day}T12:00:00`),
        partySize * PER_GUEST_COP,
        partySize,
      );
    }

    const paid = await reports.billingDetail(restaurant, month('2026-04'), {
      page: 1,
      pageSize: 50,
    });
    expect(paid).toMatchObject({
      status: 'paid',
      amountCop: 4000,
      snapshot: { amountCop: 4000, checkIns: 2 },
      amountMismatch: false,
    });

    const october = await reports.billingDetail(restaurant, month('2026-10'), {
      page: 1,
      pageSize: 50,
    });
    expect(october).toMatchObject({
      status: 'pending',
      totalCheckIns: 4,
      amountCop: 18000,
      snapshot: null,
      amountMismatch: false,
    });
    expect(
      october.items.map((item) => [item.partySize, item.feeCop]).sort(),
    ).toEqual([
      [1, 1500],
      [2, 3000],
      [4, 6000],
      [5, 7500],
    ]);

    // Cobrar octubre: el snapshot es la suma guardada, sin recalcular con la tarifa.
    await periods.markPaid(admin, restaurant, month('2026-10'));
    const octoberPaid = await reports.billingDetail(
      restaurant,
      month('2026-10'),
      { page: 1, pageSize: 50 },
    );
    expect(octoberPaid).toMatchObject({
      status: 'paid',
      snapshot: { amountCop: 18000, checkIns: 4 },
      amountMismatch: false,
    });
    // Abril sigue intacto después de cobrar otro mes.
    const aprilAgain = await reports.billingDetail(
      restaurant,
      month('2026-04'),
      {
        page: 1,
        pageSize: 50,
      },
    );
    expect(aprilAgain).toMatchObject({
      snapshot: { amountCop: 4000, checkIns: 2 },
      amountMismatch: false,
    });
  });
});
