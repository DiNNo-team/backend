import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { BillingStatementService } from '../../src/modules/reservations-checkin/billing/billing-statement.service.js';
import {
  parseReportPeriod,
  type ReportPeriod,
} from '../../src/modules/reservations-checkin/reports/report-period.js';
import {
  RestaurantMetricsService,
  type PlatformMetrics,
} from '../../src/modules/reservations-checkin/reports/restaurant-metrics.service.js';
import { AdminFixtures } from './support/admin-fixtures.js';
import { closeTestDataSource, openTestDataSource } from './support/scenario.js';
import { connectTestDatabase } from './support/test-db.js';

// Métricas de toda la plataforma (panel del administrador): byDate y byDayHour
// contra Postgres REAL. Usa marzo de 2020 y el año 2020 (completo, bisiesto: 366
// días) y compara por diferencia (antes/después): la base de pruebas es una copia
// de datos reales y nunca se toca nada que estas pruebas no hayan creado.

// 2026-11-17 10:00 en Bogotá.
const NOW = new Date('2026-11-17T15:00:00Z');

// Instantes de Bogotá (UTC-5) escritos como hora local de Bogotá.
const bogota = (local: string) => new Date(`${local}-05:00`);

function period(from: string, to: string): ReportPeriod {
  const result = parseReportPeriod({ from, to }, NOW);
  if (!result.ok) throw new Error(result.errors.join());
  return result.period;
}

const sum = (rows: { reservations: number }[]) =>
  rows.reduce((total, row) => total + row.reservations, 0);

function deltaByDate(before: PlatformMetrics, after: PlatformMetrics) {
  return after.byDate.map((row, index) => ({
    date: row.date,
    reservations: row.reservations - before.byDate[index].reservations,
  }));
}

describe('Métricas de plataforma: byDate y byDayHour (Postgres)', () => {
  let client: Client;
  let dataSource: DataSource;
  let fixtures: AdminFixtures;
  let metrics: RestaurantMetricsService;

  beforeAll(async () => {
    client = await connectTestDatabase();
    dataSource = await openTestDataSource();
    fixtures = new AdminFixtures(client);
    metrics = new RestaurantMetricsService(
      dataSource,
      new BillingStatementService(dataSource),
    );
  });

  afterAll(async () => {
    try {
      await fixtures.cleanup();
    } finally {
      await closeTestDataSource(dataSource);
      await client.end();
    }
  });

  it('una entrada por cada día del periodo, en orden, con los días en 0', async () => {
    const march = period('2020-03-01', '2020-03-07');
    const restaurant = await fixtures.restaurant();
    const before = await metrics.forPlatform(march);
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-02T12:00:00'),
    );
    await fixtures.reservation(
      restaurant,
      'cancelled',
      bogota('2020-03-02T18:00:00'),
    );
    await fixtures.reservation(
      restaurant,
      'expired',
      bogota('2020-03-05T09:00:00'),
    );

    const after = await metrics.forPlatform(march);

    expect(after.byDate.map((row) => row.date)).toEqual([
      '2020-03-01',
      '2020-03-02',
      '2020-03-03',
      '2020-03-04',
      '2020-03-05',
      '2020-03-06',
      '2020-03-07',
    ]);
    expect(deltaByDate(before, after).map((row) => row.reservations)).toEqual([
      0, 2, 0, 0, 1, 0, 0,
    ]);
    // Los días sin reservas salen en 0, nunca ausentes.
    expect(
      after.byDate.every((row) => Number.isInteger(row.reservations)),
    ).toBe(true);
  });

  it('las sumas cuadran: byDate = byDayHour = reservations.created, y también las horas y los días', async () => {
    const march = period('2020-03-08', '2020-03-14');
    const restaurant = await fixtures.restaurant();
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-09T08:15:00'),
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-09T08:45:00'),
    );
    await fixtures.reservation(
      restaurant,
      'cancelled',
      bogota('2020-03-12T21:00:00'),
    );
    await fixtures.reservation(
      restaurant,
      'expired',
      bogota('2020-03-14T23:59:00'),
    );

    const result = await metrics.forPlatform(march);

    expect(result.reservations.created).toBeGreaterThanOrEqual(4);
    expect(sum(result.byDate)).toBe(result.reservations.created);
    expect(sum(result.byDayHour)).toBe(result.reservations.created);
    expect(sum(result.hourly)).toBe(result.reservations.created);
    expect(sum(result.byDayOfWeek)).toBe(result.reservations.created);
  });

  it('el límite de medianoche es el de Bogotá: 23:30 es de ese día y 00:10 es del siguiente', async () => {
    const days = period('2020-03-10', '2020-03-11');
    const restaurant = await fixtures.restaurant();
    const before = await metrics.forPlatform(days);
    // 2020-03-10 23:30 en Bogotá = 2020-03-11 04:30 UTC: todavía es el 10 (martes).
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-10T23:30:00'),
    );
    // 2020-03-11 00:10 en Bogotá = 2020-03-11 05:10 UTC: ya es el 11 (miércoles).
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-11T00:10:00'),
    );

    const after = await metrics.forPlatform(days);

    expect(deltaByDate(before, after)).toEqual([
      { date: '2020-03-10', reservations: 1 },
      { date: '2020-03-11', reservations: 1 },
    ]);
    const cell = (data: PlatformMetrics, dayOfWeek: number, hour: number) =>
      data.byDayHour.find(
        (entry) => entry.dayOfWeek === dayOfWeek && entry.hour === hour,
      )?.reservations ?? 0;
    expect(cell(after, 2, 23) - cell(before, 2, 23)).toBe(1);
    expect(cell(after, 3, 0) - cell(before, 3, 0)).toBe(1);
  });

  it('un periodo de 1 día: una entrada en byDate y siempre 168 celdas', async () => {
    const oneDay = period('2020-03-10', '2020-03-10');
    const restaurant = await fixtures.restaurant();
    const before = await metrics.forPlatform(oneDay);
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-10T15:00:00'),
    );

    const after = await metrics.forPlatform(oneDay);

    expect(after.byDate).toHaveLength(1);
    expect(after.byDate[0].date).toBe('2020-03-10');
    expect(after.byDate[0].reservations - before.byDate[0].reservations).toBe(
      1,
    );
    expect(after.byDayHour).toHaveLength(168);
    expect(sum(after.byDayHour)).toBe(after.reservations.created);
  });

  it('un periodo de 366 días (2020 completo, bisiesto): 366 entradas, con el 29 de febrero y las sumas cuadradas', async () => {
    const year = period('2020-01-01', '2020-12-31');
    const restaurant = await fixtures.restaurant();
    const before = await metrics.forPlatform(year);
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-01-01T00:05:00'),
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-02-29T12:00:00'),
    );
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-12-31T23:55:00'),
    );

    const after = await metrics.forPlatform(year);

    expect(after.byDate).toHaveLength(366);
    expect(after.byDate[0].date).toBe('2020-01-01');
    expect(after.byDate[365].date).toBe('2020-12-31');
    const dates = after.byDate.map((row) => row.date);
    expect(new Set(dates).size).toBe(366);
    expect(dates).toEqual([...dates].sort());
    const delta = deltaByDate(before, after);
    expect(delta.find((row) => row.date === '2020-02-29')?.reservations).toBe(
      1,
    );
    expect(delta[0].reservations).toBe(1);
    expect(delta[365].reservations).toBe(1);
    expect(sum(after.byDate)).toBe(after.reservations.created);
    expect(sum(after.byDayHour)).toBe(after.reservations.created);
    expect(after.reservations.created - before.reservations.created).toBe(3);
  });

  it('el camino del restaurante no cambia: sin los dos desgloses nuevos', async () => {
    const restaurant = await fixtures.restaurant();
    await fixtures.reservation(
      restaurant,
      'completed',
      bogota('2020-03-20T10:00:00'),
    );

    const result = await metrics.forRestaurant(
      restaurant,
      period('2020-03-01', '2020-03-31'),
    );

    expect(result.reservations.created).toBe(1);
    expect(result).not.toHaveProperty('byDate');
    expect(result).not.toHaveProperty('byDayHour');
    expect(result.peakHours).toEqual([{ hour: 10, reservations: 1 }]);
  });
});
