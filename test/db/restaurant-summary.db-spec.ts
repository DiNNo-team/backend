import type { DataSource } from 'typeorm';
import { BillingStatementService } from '../../src/modules/reservations-checkin/billing/billing-statement.service.js';
import { previousComparablePeriod } from '../../src/modules/reservations-checkin/reports/comparable-period.js';
import { parseReportPeriod } from '../../src/modules/reservations-checkin/reports/report-period.js';
import { RestaurantMetricsService } from '../../src/modules/reservations-checkin/reports/restaurant-metrics.service.js';
import { RestaurantSummaryReader } from '../../src/modules/reservations-checkin/reports/restaurant-summary.reader.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario,
  type Scenario,
} from './support/scenario.js';
import { randomCode } from './support/script-data.js';

// Lo nuevo del resumen del restaurante (días, comensales, tramo anterior, meses
// y mapa de calor) contra Postgres REAL: el día y el mes son los de Bogotá
// (UTC-5), con reservas y check-ins sembrados en los bordes de medianoche, y un
// segundo restaurante que nunca debe aparecer. Commits reales; cada escenario
// se borra al final.

let dataSource: DataSource;
let reader: RestaurantSummaryReader;
let metrics: RestaurantMetricsService;

beforeAll(async () => {
  dataSource = await openTestDataSource();
  reader = new RestaurantSummaryReader(dataSource);
  metrics = new RestaurantMetricsService(
    dataSource,
    new BillingStatementService(dataSource),
  );
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

interface Seed {
  // created_at en UTC (comentario: la hora de Bogotá).
  createdAt: string;
  status: 'cancelled' | 'expired' | 'completed';
  partySize: number;
  checkIn?: { at: string; feeCop: number };
}

async function seed(scenario: Scenario, rows: Seed[]): Promise<void> {
  const tableId = scenario.tableIds.get('01') as string;
  for (const [index, row] of rows.entries()) {
    const created = new Date(row.createdAt);
    const expires = new Date(created.getTime() + 15 * 60_000);
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

function period(from: string, to: string, now = '2026-11-15T14:30:00Z') {
  const result = parseReportPeriod({ from, to }, new Date(now));
  if (!result.ok) throw new Error(result.errors.join());
  return result.period;
}

const TABLES = [{ identifier: '01', capacity: 8 }];

// Restaurante A: lo que debe verse.
const OWN: Seed[] = [
  // Reservada el 31 oct 23:59 (Bogotá), check-in el 1 nov 00:10: la reserva es
  // de octubre y el check-in, de noviembre.
  {
    createdAt: '2026-11-01T04:59:00Z',
    status: 'completed',
    partySize: 3,
    checkIn: { at: '2026-11-01T05:10:00Z', feeCop: 2000 },
  },
  // 1 nov 00:00 en punto, cancelada.
  { createdAt: '2026-11-01T05:00:00Z', status: 'cancelled', partySize: 2 },
  // 1 nov 15:00, vencida.
  { createdAt: '2026-11-01T20:00:00Z', status: 'expired', partySize: 4 },
  // 3 nov 12:00, con check-in a las 12:20.
  {
    createdAt: '2026-11-03T17:00:00Z',
    status: 'completed',
    partySize: 2,
    checkIn: { at: '2026-11-03T17:20:00Z', feeCop: 3000 },
  },
  // 5 oct 12:00.
  {
    createdAt: '2026-10-05T17:00:00Z',
    status: 'completed',
    partySize: 5,
    checkIn: { at: '2026-10-05T17:30:00Z', feeCop: 2000 },
  },
  // 10 jun 12:00.
  {
    createdAt: '2026-06-10T17:00:00Z',
    status: 'completed',
    partySize: 4,
    checkIn: { at: '2026-06-10T17:10:00Z', feeCop: 1000 },
  },
  // 1 jun 00:00 en punto (Bogotá): ya es junio.
  {
    createdAt: '2026-06-01T04:00:00Z',
    status: 'completed',
    partySize: 1,
    checkIn: { at: '2026-06-01T05:00:00Z', feeCop: 1000 },
  },
  // 31 may 23:59: es mayo, fuera de los 6 meses.
  {
    createdAt: '2026-05-31T20:00:00Z',
    status: 'completed',
    partySize: 6,
    checkIn: { at: '2026-06-01T04:59:00Z', feeCop: 1000 },
  },
];

// Restaurante B: nunca debe aparecer en las cifras de A.
const OTHER: Seed[] = [
  {
    createdAt: '2026-11-01T17:00:00Z',
    status: 'completed',
    partySize: 9,
    checkIn: { at: '2026-11-01T17:10:00Z', feeCop: 2000 },
  },
  { createdAt: '2026-11-02T17:00:00Z', status: 'cancelled', partySize: 7 },
  {
    createdAt: '2026-10-02T17:00:00Z',
    status: 'completed',
    partySize: 8,
    checkIn: { at: '2026-10-02T17:10:00Z', feeCop: 2000 },
  },
];

describe('Resumen del restaurante: días, comensales, meses y mapa de calor (Postgres)', () => {
  it('daily: una entrada por día con ceros, en hora de Bogotá y sin el otro restaurante', async () => {
    await withScenario(dataSource, TABLES, OWN.length, async (own) => {
      await withScenario(dataSource, TABLES, OTHER.length, async (other) => {
        await seed(own, OWN);
        await seed(other, OTHER);

        const days = await reader.daily(
          own.restaurantId,
          period('2026-11-01', '2026-11-03'),
        );

        expect(days).toEqual([
          // La reserva de las 23:59 del 31 oct no es del 1 nov, pero su check-in
          // de las 00:10 sí.
          {
            date: '2026-11-01',
            reservationsCreated: 2,
            checkIns: 1,
            guests: 3,
            cancelled: 1,
            expired: 1,
          },
          {
            date: '2026-11-02',
            reservationsCreated: 0,
            checkIns: 0,
            guests: 0,
            cancelled: 0,
            expired: 0,
          },
          {
            date: '2026-11-03',
            reservationsCreated: 1,
            checkIns: 1,
            guests: 2,
            cancelled: 0,
            expired: 0,
          },
        ]);
      });
    });
  });

  it('las sumas por día cuadran con los totales del periodo y con el cobro', async () => {
    await withScenario(dataSource, TABLES, OWN.length, async (own) => {
      await seed(own, OWN);
      const range = period('2026-06-01', '2026-11-15');

      const [days, totals, billing] = await Promise.all([
        reader.daily(own.restaurantId, range),
        reader.totals(own.restaurantId, range),
        new BillingStatementService(dataSource).totals(own.restaurantId, range),
      ]);

      expect(days).toHaveLength(168);
      const sum = (key: 'reservationsCreated' | 'checkIns' | 'guests') =>
        days.reduce((total, day) => total + day[key], 0);
      expect(sum('reservationsCreated')).toBe(totals.reservationsCreated);
      expect(sum('checkIns')).toBe(totals.checkIns);
      expect(sum('guests')).toBe(totals.guests);
      // Misma regla de cobro que el estado de cuenta.
      expect(totals.checkIns).toBe(billing.checkIns);
      expect(totals.amountCop).toBe(billing.amountCop);
      // 3 + 2 + 5 + 4 + 1: el de 6 personas es del 31 may y no entra.
      expect(totals.guests).toBe(15);
    });
  });

  it('totals: solo el restaurante y el periodo, con el borde de medianoche', async () => {
    await withScenario(dataSource, TABLES, OWN.length, async (own) => {
      await withScenario(dataSource, TABLES, OTHER.length, async (other) => {
        await seed(own, OWN);
        await seed(other, OTHER);

        expect(
          await reader.totals(
            own.restaurantId,
            period('2026-11-01', '2026-11-03'),
          ),
        ).toEqual({
          // La reserva de las 23:59 del 31 oct no cuenta como creada en noviembre.
          reservationsCreated: 3,
          checkIns: 2,
          guests: 5,
          amountCop: 5000,
        });
        expect(
          await reader.totals(
            other.restaurantId,
            period('2026-11-01', '2026-11-03'),
          ),
        ).toEqual({
          reservationsCreated: 2,
          checkIns: 1,
          guests: 9,
          amountCop: 2000,
        });
      });
    });
  });

  it('monthly: los 6 meses que terminan en el mes pedido, con ceros y la medianoche de Bogotá', async () => {
    await withScenario(dataSource, TABLES, OWN.length, async (own) => {
      await withScenario(dataSource, TABLES, OTHER.length, async (other) => {
        await seed(own, OWN);
        await seed(other, OTHER);

        expect(await reader.monthly(own.restaurantId, '2026-11', 6)).toEqual([
          // Del 1 jun 00:00 (4 + 1 personas...): el check-in de las 23:59 del 31
          // may queda en mayo y fuera.
          { month: '2026-06', guests: 5, checkIns: 2 },
          { month: '2026-07', guests: 0, checkIns: 0 },
          { month: '2026-08', guests: 0, checkIns: 0 },
          { month: '2026-09', guests: 0, checkIns: 0 },
          { month: '2026-10', guests: 5, checkIns: 1 },
          { month: '2026-11', guests: 5, checkIns: 2 },
        ]);
        // Cruza el año: los meses de 2025 salen en 0.
        const crossing = await reader.monthly(own.restaurantId, '2026-02', 6);
        expect(crossing.map((month) => month.month)).toEqual([
          '2025-09',
          '2025-10',
          '2025-11',
          '2025-12',
          '2026-01',
          '2026-02',
        ]);
        expect(crossing.every((month) => month.guests === 0)).toBe(true);
      });
    });
  });

  it('el tramo anterior: febrero de 28 y de 29 días contra marzo, con la medianoche de Bogotá', async () => {
    const rows: Seed[] = [
      // 28 feb 2026 23:59 (Bogotá): último minuto de febrero.
      {
        createdAt: '2026-03-01T04:00:00Z',
        status: 'completed',
        partySize: 2,
        checkIn: { at: '2026-03-01T04:59:00Z', feeCop: 2000 },
      },
      // 1 mar 2026 00:00 en punto: primer minuto de marzo.
      {
        createdAt: '2026-03-01T04:30:00Z',
        status: 'completed',
        partySize: 3,
        checkIn: { at: '2026-03-01T05:00:00Z', feeCop: 2000 },
      },
      // 29 feb 2028 23:59 y 1 mar 2028 00:00 (2028 es bisiesto).
      {
        createdAt: '2028-03-01T04:00:00Z',
        status: 'completed',
        partySize: 4,
        checkIn: { at: '2028-03-01T04:59:00Z', feeCop: 2000 },
      },
      {
        createdAt: '2028-03-01T04:30:00Z',
        status: 'completed',
        partySize: 5,
        checkIn: { at: '2028-03-01T05:00:00Z', feeCop: 2000 },
      },
    ];
    await withScenario(dataSource, TABLES, rows.length, async (own) => {
      await seed(own, rows);

      const now2026 = new Date('2026-11-15T14:30:00Z');
      const march = period('2026-03-01', '2026-03-31');
      const previous = previousComparablePeriod(march, now2026);
      expect([previous.from, previous.to]).toEqual([
        '2026-02-01',
        '2026-02-28',
      ]);
      expect((await reader.totals(own.restaurantId, previous)).guests).toBe(2);
      expect((await reader.totals(own.restaurantId, march)).guests).toBe(3);

      const now2028 = '2028-12-01T14:30:00Z';
      const march2028 = period('2028-03-01', '2028-03-31', now2028);
      const leap = previousComparablePeriod(march2028, new Date(now2028));
      expect([leap.from, leap.to]).toEqual(['2028-02-01', '2028-02-29']);
      expect((await reader.totals(own.restaurantId, leap)).guests).toBe(4);
      expect((await reader.totals(own.restaurantId, march2028)).guests).toBe(5);
    });
  });

  it('un restaurante sin datos: días y meses en cero, sin romper', async () => {
    await withScenario(dataSource, TABLES, 0, async (own) => {
      const days = await reader.daily(
        own.restaurantId,
        period('2026-11-01', '2026-11-10'),
      );
      expect(days).toHaveLength(10);
      expect(
        days.every(
          (day) =>
            day.reservationsCreated === 0 &&
            day.checkIns === 0 &&
            day.guests === 0,
        ),
      ).toBe(true);
      expect(
        await reader.totals(
          own.restaurantId,
          period('2026-11-01', '2026-11-10'),
        ),
      ).toEqual({
        reservationsCreated: 0,
        checkIns: 0,
        guests: 0,
        amountCop: 0,
      });
      const months = await reader.monthly(own.restaurantId, '2026-11', 6);
      expect(months).toHaveLength(6);
      expect(months.every((month) => month.guests === 0)).toBe(true);
    });
  });

  it('el mapa de calor del restaurante: 168 celdas, en hora de Bogotá y sin el otro restaurante', async () => {
    await withScenario(dataSource, TABLES, OWN.length, async (own) => {
      await withScenario(dataSource, TABLES, OTHER.length, async (other) => {
        await seed(own, OWN);
        await seed(other, OTHER);
        const range = period('2026-11-01', '2026-11-03');

        const cells = await metrics.dayHourForRestaurant(
          own.restaurantId,
          range,
        );

        expect(cells).toHaveLength(168);
        const at = (dayOfWeek: number, hour: number) =>
          cells.find(
            (cell) => cell.dayOfWeek === dayOfWeek && cell.hour === hour,
          )?.reservations;
        // domingo 1 nov 00:00 (cancelada) y 15:00 (vencida); martes 3 nov 12:00.
        expect(at(7, 0)).toBe(1);
        expect(at(7, 15)).toBe(1);
        expect(at(2, 12)).toBe(1);
        // Las reservas del otro restaurante (domingo 12:00) no están.
        expect(at(7, 12)).toBe(0);
        expect(cells.reduce((sum, cell) => sum + cell.reservations, 0)).toBe(3);
      });
    });
  });

  it('el detalle de un día (from = to) filtra por el día de Bogotá, no por el de UTC', async () => {
    const rows: Seed[] = [
      // 31 oct 23:59 (Bogotá) = 1 nov 04:59 UTC: es del 31 oct aunque en UTC ya
      // sea 1 nov.
      {
        createdAt: '2026-11-01T04:30:00Z',
        status: 'completed',
        partySize: 2,
        checkIn: { at: '2026-11-01T04:59:00Z', feeCop: 2000 },
      },
      // 1 nov 00:00 (Bogotá) en punto.
      {
        createdAt: '2026-11-01T04:40:00Z',
        status: 'completed',
        partySize: 3,
        checkIn: { at: '2026-11-01T05:00:00Z', feeCop: 2000 },
      },
      // 1 nov 23:59 (Bogotá) = 2 nov 04:59 UTC: sigue siendo del 1 nov.
      {
        createdAt: '2026-11-02T04:30:00Z',
        status: 'completed',
        partySize: 4,
        checkIn: { at: '2026-11-02T04:59:00Z', feeCop: 2000 },
      },
    ];
    await withScenario(dataSource, TABLES, rows.length, async (own) => {
      await seed(own, rows);
      const billing = new BillingStatementService(dataSource);
      const partySizes = async (day: string) =>
        (
          await billing.statement(own.restaurantId, period(day, day), {
            page: 1,
            pageSize: 200,
          })
        ).items.map((item) => item.partySize);

      expect(await partySizes('2026-10-31')).toEqual([2]);
      expect(await partySizes('2026-11-01')).toEqual([4, 3]);
      expect(await partySizes('2026-11-02')).toEqual([]);
    });
  });
});
