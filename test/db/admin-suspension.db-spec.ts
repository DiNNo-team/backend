import { HttpException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import { RestaurantReviewService } from '../../src/modules/restaurant-operations/restaurant-review/restaurant-review.service.js';
import { Restaurant } from '../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { AdminFixtures } from './support/admin-fixtures.js';
import { closeTestDataSource, openTestDataSource } from './support/scenario.js';
import {
  CHECK_VIOLATION,
  connectTestDatabase,
  expectDatabaseError,
  inRolledBackTransaction,
} from './support/test-db.js';

// Suspender y reactivar (panel del administrador) contra Postgres REAL: dos
// administradores a la vez sobre el mismo restaurante, y las reglas que impone
// la base. Con commits (la carrera los necesita); se borra solo lo creado.

const ROUNDS = 8;
const REASON = 'Varios comensales reportaron mesas que no existían.';

interface SuspensionRow {
  approval_status: string;
  suspension_reason: string | null;
  suspended_by: string | null;
}

describe('Suspensión de restaurantes con carreras (Postgres)', () => {
  let client: Client;
  let dataSource: DataSource;
  let fixtures: AdminFixtures;
  let service: RestaurantReviewService;
  const now = new Date();

  beforeAll(async () => {
    client = await connectTestDatabase();
    dataSource = await openTestDataSource();
    fixtures = new AdminFixtures(client);
    service = new RestaurantReviewService(
      dataSource.getRepository(Restaurant),
      { now: () => now },
      { emit: () => true } as unknown as EventEmitter2,
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

  const rowOf = async (id: string) =>
    (
      await client.query<SuspensionRow>(
        `SELECT approval_status, suspension_reason, suspended_by FROM restaurants WHERE id = $1`,
        [id],
      )
    ).rows[0];

  it('dos suspensiones a la vez: una gana, la otra recibe 409 y la auditoría es la de la ganadora', async () => {
    const tally = [0, 0];
    for (let round = 0; round < ROUNDS; round += 1) {
      const id = await fixtures.restaurant('approved');
      const admins = [await fixtures.admin(), await fixtures.admin()];

      const results = await Promise.allSettled(
        admins.map((admin) => service.suspend(admin, id, REASON)),
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
        errorCode: 'RESTAURANT_NOT_APPROVED',
      });
      expect(await rowOf(id)).toEqual({
        approval_status: 'suspended',
        suspension_reason: REASON,
        suspended_by: admins[won[0]],
      });
    }
    process.stdout.write(
      `[dos suspensiones] ${ROUNDS} rondas: ganó la primera=${tally[0]} la segunda=${tally[1]}\n`,
    );
  });

  it('reactivar contra reactivar: una gana y la otra recibe 409 RESTAURANT_NOT_SUSPENDED', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const id = await fixtures.restaurant('suspended');

      const results = await Promise.allSettled([
        service.reactivate(id),
        service.reactivate(id),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const loser = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect((loser!.reason as HttpException).getResponse()).toMatchObject({
        statusCode: 409,
        errorCode: 'RESTAURANT_NOT_SUSPENDED',
      });
      // Reactivado conserva la última suspensión.
      expect(await rowOf(id)).toMatchObject({
        approval_status: 'approved',
        suspension_reason: 'Motivo de prueba de la suspensión.',
      });
    }
  });

  it('la base no deja un suspendido sin motivo, fecha ni administrador, ni un estado desconocido', async () => {
    const id = await fixtures.restaurant('approved');
    await inRolledBackTransaction(client, async () => {
      const withoutReason = await expectDatabaseError(
        client,
        `UPDATE restaurants SET approval_status = 'suspended' WHERE id = $1`,
        [id],
      );
      expect(withoutReason).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'CHK_restaurants_suspension',
      });
      const unknown = await expectDatabaseError(
        client,
        `UPDATE restaurants SET approval_status = 'archived' WHERE id = $1`,
        [id],
      );
      expect(unknown).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'CHK_restaurants_approval_status',
      });
    });
  });
});
