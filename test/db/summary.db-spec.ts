import type { DataSource } from 'typeorm';
import { BillingStatementService } from '../../src/modules/reservations-checkin/billing/billing-statement.service.js';
import { parseReportPeriod } from '../../src/modules/reservations-checkin/reports/report-period.js';
import { RestaurantMetricsService } from '../../src/modules/reservations-checkin/reports/restaurant-metrics.service.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario,
  type Scenario,
} from './support/scenario.js';
import { randomCode } from './support/script-data.js';

// Resumen del restaurante (CLAUDE.md §11, "Resumen y KPIs") contra Postgres
// REAL: las agregaciones con AT TIME ZONE 'America/Bogota', con reservas y
// check-ins sembrados en días y horas conocidos, incluidos los bordes de
// medianoche (Bogotá = UTC-5). Commits reales: el escenario se borra al final.

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

interface Seed {
  // created_at en UTC (comentario: la hora de Bogotá).
  createdAt: string;
  status: 'active' | 'cancelled' | 'expired' | 'completed';
  partySize: number;
  checkIn?: { at: string; feeCop: number };
}

const SEEDS: Seed[] = [
  // lunes 2026-10-05 12:00 Bogotá
  {
    createdAt: '2026-10-05T17:00:00Z',
    status: 'completed',
    partySize: 2,
    checkIn: { at: '2026-10-05T17:20:00Z', feeCop: 2000 },
  },
  // lunes 12:30
  { createdAt: '2026-10-05T17:30:00Z', status: 'cancelled', partySize: 4 },
  // lunes 20:00 (ya martes en UTC)
  { createdAt: '2026-10-06T01:00:00Z', status: 'expired', partySize: 3 },
  // lunes 23:59, check-in el martes 00:10
  {
    createdAt: '2026-10-06T04:59:00Z',
    status: 'completed',
    partySize: 2,
    checkIn: { at: '2026-10-06T05:10:00Z', feeCop: 3500 },
  },
  // martes 2026-10-06 00:00 en punto
  { createdAt: '2026-10-06T05:00:00Z', status: 'expired', partySize: 6 },
  // domingo 2026-10-11 12:00, todavía activa
  { createdAt: '2026-10-11T17:00:00Z', status: 'active', partySize: 2 },
  // Fuera del periodo por created_at (miércoles 2026-09-30 23:59), pero su
  // check-in es el jueves 2026-10-01 00:05: cuenta en el cobro, no en reservas.
  {
    createdAt: '2026-10-01T04:59:00Z',
    status: 'completed',
    partySize: 5,
    checkIn: { at: '2026-10-01T05:05:00Z', feeCop: 1000 },
  },
  // Fuera: domingo 2026-11-01 00:00 en Bogotá.
  { createdAt: '2026-11-01T05:00:00Z', status: 'cancelled', partySize: 2 },
];

async function seed(scenario: Scenario): Promise<void> {
  const tableId = scenario.tableIds.get('01') as string;
  for (const [index, row] of SEEDS.entries()) {
    const created = new Date(row.createdAt);
    const expires = new Date(
      row.status === 'active'
        ? Date.now() + 15 * 60_000
        : created.getTime() + 15 * 60_000,
    );
    const [{ id }] = await dataSource.query<{ id: string }[]>(
      `INSERT INTO reservations
         (code, status, party_size, diner_id, restaurant_id, table_id, created_at, expires_at,
          cancelled_at, expired_at, checked_in_at, no_show)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        randomCode(),
        row.status,
        row.partySize,
        scenario.dinerIds[index],
        scenario.restaurantId,
        tableId,
        created,
        expires,
        row.status === 'cancelled' ? created : null,
        row.status === 'expired' ? expires : null,
        row.checkIn ? new Date(row.checkIn.at) : null,
        row.status === 'expired',
      ],
    );
    if (row.checkIn) {
      await dataSource.query(
        `INSERT INTO check_ins (reservation_id, restaurant_id, checked_in_at, fee_cop) VALUES ($1, $2, $3, $4)`,
        [
          id,
          scenario.restaurantId,
          new Date(row.checkIn.at),
          row.checkIn.feeCop,
        ],
      );
    }
  }
}

function october() {
  const result = parseReportPeriod(
    { from: '2026-10-01', to: '2026-10-31' },
    new Date('2026-11-15T14:30:00Z'),
  );
  if (!result.ok) throw new Error(result.errors.join());
  return result.period;
}

describe('Resumen del restaurante (Postgres)', () => {
  it('calcula cada número en hora de Bogotá, con los bordes de medianoche', async () => {
    await withScenario(
      dataSource,
      [{ identifier: '01', capacity: 8 }],
      SEEDS.length,
      async (scenario) => {
        await seed(scenario);
        const metrics = new RestaurantMetricsService(
          dataSource,
          new BillingStatementService(dataSource),
        );

        expect(
          await metrics.forRestaurant(scenario.restaurantId, october()),
        ).toEqual({
          // Check-ins del 5, del 6 a las 00:10 y del 1 a las 00:05.
          billing: { checkIns: 3, amountCop: 6500 },
          reservations: {
            created: 6,
            completed: 2,
            cancelled: 1,
            expired: 2,
            active: 1,
          },
          rates: { conversion: 0.3333, noShow: 0.5, cancellation: 0.1667 },
          // (2 + 4 + 3 + 2 + 6 + 2) / 6
          averagePartySize: 3.17,
          peakHours: [
            { hour: 12, reservations: 3 },
            { hour: 0, reservations: 1 },
            { hour: 20, reservations: 1 },
          ],
          byDayOfWeek: [
            { dayOfWeek: 1, reservations: 4 },
            { dayOfWeek: 2, reservations: 1 },
            { dayOfWeek: 3, reservations: 0 },
            { dayOfWeek: 4, reservations: 0 },
            { dayOfWeek: 5, reservations: 0 },
            { dayOfWeek: 6, reservations: 0 },
            { dayOfWeek: 7, reservations: 1 },
          ],
        });
      },
    );
  });

  it('un restaurante sin datos en el periodo: ceros, null y listas vacías', async () => {
    await withScenario(
      dataSource,
      [{ identifier: '01', capacity: 2 }],
      0,
      async (scenario) => {
        const metrics = new RestaurantMetricsService(
          dataSource,
          new BillingStatementService(dataSource),
        );
        const result = await metrics.forRestaurant(
          scenario.restaurantId,
          october(),
        );

        expect(result).toMatchObject({
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
          peakHours: [],
        });
        expect(result.byDayOfWeek.every((day) => day.reservations === 0)).toBe(
          true,
        );
      },
    );
  });

  it('existe el índice (restaurant_id, created_at) de reservations', async () => {
    const rows = await dataSource.query<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'reservations' AND indexname = 'IDX_reservations_restaurant_id_created_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('(restaurant_id, created_at)');
  });
});
