import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { RestaurantResubmitService } from '../../src/modules/restaurant-operations/restaurants/restaurant-resubmit.service.js';
import { Restaurant } from '../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { closeTestDataSource, openTestDataSource } from './support/scenario.js';
import { connectTestDatabase } from './support/test-db.js';

// Reenvío de una solicitud rechazada (CLAUDE.md §11) contra Postgres REAL, con
// reenvíos simultáneos. Con commits: cada ronda crea su restaurante rechazado y
// al final se borra lo creado, en orden de FK, aunque falle.

const ROUNDS = 6;
const RESUBMITS = 4;

describe('Reenvío de la solicitud con carreras (Postgres)', () => {
  let client: Client;
  let dataSource: DataSource;
  let service: RestaurantResubmitService;
  const restaurants: string[] = [];
  const admins: string[] = [];
  const now = new Date();

  beforeAll(async () => {
    client = await connectTestDatabase();
    dataSource = await openTestDataSource();
    service = new RestaurantResubmitService(
      dataSource.getRepository(Restaurant),
      { now: () => now },
    );
  });

  afterAll(async () => {
    try {
      await client.query(`DELETE FROM restaurants WHERE id = ANY($1::uuid[])`, [
        restaurants,
      ]);
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
        admins,
      ]);
    } finally {
      await closeTestDataSource(dataSource);
      await client.end();
    }
  });

  async function newRejectedRestaurant(): Promise<string> {
    const admin = await client.query<{ id: string }>(
      `INSERT INTO users (email, role) VALUES ($1, 'platform_admin') RETURNING id`,
      [`db-test-resubmit-${randomUUID()}@dinno.test`],
    );
    admins.push(admin.rows[0].id);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO restaurants (name, approval_status, rejection_reason, reviewed_by, reviewed_at, submitted_at)
       VALUES ($1, 'rejected', 'Faltan datos del local.', $2, now() - interval '1 day', now() - interval '2 days')
       RETURNING id`,
      [`db-test-resubmit-${randomUUID()}`, admin.rows[0].id],
    );
    restaurants.push(rows[0].id);
    return rows[0].id;
  }

  it(`${RESUBMITS} reenvíos a la vez: uno gana, los demás reciben 409 y el estado queda limpio`, async () => {
    const tally: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const id = await newRejectedRestaurant();
      const results = await Promise.allSettled(
        Array.from({ length: RESUBMITS }, () => service.resubmit(id)),
      );
      const won = results.filter((result) => result.status === 'fulfilled');
      const lost = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      tally.push(won.length);

      expect(won).toHaveLength(1);
      for (const { reason } of lost) {
        expect(reason).toBeInstanceOf(HttpException);
        expect((reason as HttpException).getResponse()).toMatchObject({
          statusCode: 409,
          errorCode: 'RESTAURANT_NOT_REJECTED',
        });
      }
      const { rows } = await client.query(
        `SELECT approval_status, rejection_reason, reviewed_by, reviewed_at, submitted_at FROM restaurants WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        approval_status: 'pending',
        rejection_reason: null,
        reviewed_by: null,
        reviewed_at: null,
        submitted_at: now,
      });
    }
    process.stdout.write(
      `[reenvío simultáneo] ${ROUNDS} rondas de ${RESUBMITS}: ganadores por ronda=${tally.join(',')}\n`,
    );
  });
});
