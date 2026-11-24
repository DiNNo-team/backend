import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { RestaurantReviewService } from '../../src/modules/restaurant-operations/restaurant-review/restaurant-review.service.js';
import { Restaurant } from '../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { closeTestDataSource, openTestDataSource } from './support/scenario.js';
import { connectTestDatabase } from './support/test-db.js';

// Revisión de solicitudes (CLAUDE.md §11, "Administrador") contra Postgres REAL:
// dos administradores a la vez sobre la misma solicitud. Con commits (la carrera
// los necesita): cada ronda crea su restaurante y sus dos administradores, y al
// final se borra solo lo creado, en orden de FK, aunque falle.

const ROUNDS = 8;
const REASON = 'La dirección no coincide con el local.';

interface ReviewRow {
  approval_status: string;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
}

type Action = 'approve' | 'reject';

describe('Revisión de restaurantes con carreras (Postgres)', () => {
  let client: Client;
  let dataSource: DataSource;
  let service: RestaurantReviewService;
  const restaurants: string[] = [];
  const admins: string[] = [];
  const now = new Date();

  beforeAll(async () => {
    client = await connectTestDatabase();
    dataSource = await openTestDataSource();
    service = new RestaurantReviewService(
      dataSource.getRepository(Restaurant),
      { now: () => now },
      { emit: () => true } as unknown as EventEmitter2,
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

  async function newPendingRestaurant(): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO restaurants (name, approval_status) VALUES ($1, 'pending') RETURNING id`,
      [`db-test-review-${randomUUID()}`],
    );
    restaurants.push(rows[0].id);
    return rows[0].id;
  }

  async function newAdmin(): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, role) VALUES ($1, 'platform_admin') RETURNING id`,
      [`db-test-review-${randomUUID()}@dinno.test`],
    );
    admins.push(rows[0].id);
    return rows[0].id;
  }

  const run = (action: Action, admin: string, id: string) =>
    action === 'approve'
      ? service.approve(admin, id)
      : service.reject(admin, id, REASON);

  async function race(actions: [Action, Action]) {
    const id = await newPendingRestaurant();
    const reviewers = [await newAdmin(), await newAdmin()];
    const results = await Promise.allSettled(
      actions.map((action, index) => run(action, reviewers[index], id)),
    );
    const { rows } = await client.query<ReviewRow>(
      `SELECT approval_status, rejection_reason, reviewed_by, reviewed_at FROM restaurants WHERE id = $1`,
      [id],
    );
    return { id, reviewers, results, row: rows[0] };
  }

  function winnerOf(results: PromiseSettledResult<void>[]): number {
    const won = results.flatMap((result, index) =>
      result.status === 'fulfilled' ? [index] : [],
    );
    expect(won).toHaveLength(1);
    const [loser] = results.filter((result) => result.status === 'rejected');
    const reason = (loser as PromiseRejectedResult).reason as HttpException;
    expect(reason).toBeInstanceOf(HttpException);
    expect(reason.getResponse()).toMatchObject({
      statusCode: 409,
      errorCode: 'RESTAURANT_NOT_PENDING',
    });
    return won[0];
  }

  it('aprobar contra rechazar: una sola gana y la auditoría es la de la ganadora', async () => {
    const tally: Record<Action, number> = { approve: 0, reject: 0 };
    for (let round = 0; round < ROUNDS; round += 1) {
      // Se alterna quién sale primero para que la carrera vaya a los dos lados.
      const actions: [Action, Action] =
        round % 2 === 0 ? ['approve', 'reject'] : ['reject', 'approve'];
      const { reviewers, results, row } = await race(actions);
      const winner = winnerOf(results);
      tally[actions[winner]] += 1;

      expect(row.reviewed_by).toBe(reviewers[winner]);
      expect(row.reviewed_at).toEqual(now);
      expect(row).toMatchObject(
        actions[winner] === 'approve'
          ? { approval_status: 'approved', rejection_reason: null }
          : { approval_status: 'rejected', rejection_reason: REASON },
      );
    }
    process.stdout.write(
      `[aprobar contra rechazar] ${ROUNDS} rondas: ganó aprobar=${tally.approve} rechazar=${tally.reject}\n`,
    );
  });

  it('dos aprobaciones a la vez: una gana y la otra recibe 409', async () => {
    const tally = [0, 0];
    for (let round = 0; round < ROUNDS; round += 1) {
      const { reviewers, results, row } = await race(['approve', 'approve']);
      const winner = winnerOf(results);
      tally[winner] += 1;
      expect(row).toMatchObject({
        approval_status: 'approved',
        rejection_reason: null,
        reviewed_by: reviewers[winner],
      });
    }
    process.stdout.write(
      `[dos aprobaciones] ${ROUNDS} rondas: ganó la primera=${tally[0]} la segunda=${tally[1]}\n`,
    );
  });

  it('submitted_at existe, es NOT NULL y toma now() si el INSERT no la fija', async () => {
    const { rows } = await client.query<{
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurants' AND column_name = 'submitted_at'`,
    );
    expect(rows).toEqual([{ is_nullable: 'NO', column_default: 'now()' }]);
  });
});
