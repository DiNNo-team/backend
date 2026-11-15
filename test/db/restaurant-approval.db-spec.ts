import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Client } from 'pg';
import type { DataSource } from 'typeorm';
import type { RequestIdentity } from '../../src/modules/identity-access/index.js';
import { User } from '../../src/modules/identity-access/users/user.entity.js';
import { UsersService } from '../../src/modules/identity-access/users/users.service.js';
import { ALREADY_REGISTERED_MESSAGE } from '../../src/modules/restaurant-operations/restaurants/restaurant-registration.service.js';
import { RestaurantSignupService } from '../../src/modules/restaurant-operations/restaurants/restaurant-signup.service.js';
import { Restaurant } from '../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { closeTestDataSource, openTestDataSource } from './support/scenario.js';
import {
  CHECK_VIOLATION,
  connectTestDatabase,
  expectDatabaseError,
  inRolledBackTransaction,
} from './support/test-db.js';

// Aprobación de restaurantes (CLAUDE.md §11) contra Postgres REAL: los checks
// de estado y de rol, el backfill de la migración, la FK reviewed_by y el
// signup con una carrera de verdad. Las tres primeras partes van en una
// transacción con ROLLBACK; el signup hace commits (la carrera los necesita) y
// borra solo lo que creó, en orden de FK, aunque falle.

const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';

describe('Restaurant approval (Postgres)', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectTestDatabase();
  });

  afterAll(async () => {
    await client.end();
  });

  const insertRestaurant = (approvalStatus: string | null) =>
    client.query<{ id: string }>(
      approvalStatus === null
        ? `INSERT INTO restaurants (name) VALUES ($1) RETURNING id`
        : `INSERT INTO restaurants (name, approval_status) VALUES ($1, $2) RETURNING id`,
      approvalStatus === null
        ? [`db-test-${randomUUID()}`]
        : [`db-test-${randomUUID()}`, approvalStatus],
    );

  describe('restaurants.approval_status', () => {
    it('accepts the three states and rejects any other with its named check', async () => {
      await inRolledBackTransaction(client, async () => {
        for (const status of ['pending', 'approved', 'rejected']) {
          const { rows } = await insertRestaurant(status);
          expect(rows).toHaveLength(1);
        }

        const error = await expectDatabaseError(
          client,
          `INSERT INTO restaurants (name, approval_status) VALUES ($1, 'suspended')`,
          [`db-test-${randomUUID()}`],
        );
        expect(error).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'CHK_restaurants_approval_status',
        });
      });
    });

    it('has no default: an insert that does not set it fails (never born approved)', async () => {
      const { rows } = await client.query<{
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurants' AND column_name = 'approval_status'`,
      );
      expect(rows).toEqual([{ is_nullable: 'NO', column_default: null }]);

      await inRolledBackTransaction(client, async () => {
        const error = await expectDatabaseError(
          client,
          `INSERT INTO restaurants (name) VALUES ($1)`,
          [`db-test-${randomUUID()}`],
        );
        expect(error.code).toBe(NOT_NULL_VIOLATION);
      });
    });

    it('the migration left every existing restaurant approved', async () => {
      const { rows } = await client.query<{ status: string; count: number }>(
        `SELECT approval_status AS status, count(*)::int AS count FROM restaurants GROUP BY approval_status`,
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.filter((row) => row.status !== 'approved')).toEqual([]);
    });

    it('rejection_reason, reviewed_at and contact_phone are optional; reviewed_by points to users', async () => {
      await inRolledBackTransaction(client, async () => {
        const { rows: users } = await client.query<{ id: string }>(
          `INSERT INTO users (email, role) VALUES ($1, 'platform_admin') RETURNING id`,
          [`db-test-${randomUUID()}@example.com`],
        );
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO restaurants (name, approval_status, rejection_reason, reviewed_by, reviewed_at, contact_phone)
           VALUES ($1, 'rejected', $2, $3, now(), '+573001234567') RETURNING id`,
          [`db-test-${randomUUID()}`, 'x'.repeat(300), users[0].id],
        );
        expect(rows).toHaveLength(1);

        const tooLong = await expectDatabaseError(
          client,
          `INSERT INTO restaurants (name, approval_status, rejection_reason) VALUES ($1, 'rejected', $2)`,
          [`db-test-${randomUUID()}`, 'x'.repeat(301)],
        );
        expect(tooLong.code).toBe('22001');

        const orphan = await expectDatabaseError(
          client,
          `INSERT INTO restaurants (name, approval_status, reviewed_by) VALUES ($1, 'approved', $2)`,
          [`db-test-${randomUUID()}`, randomUUID()],
        );
        expect(orphan).toMatchObject({
          code: FOREIGN_KEY_VIOLATION,
          constraint: 'FK_restaurants_reviewed_by',
        });
      });
    });
  });

  describe('users.role', () => {
    it('accepts platform_admin and the two previous roles, and rejects any other', async () => {
      await inRolledBackTransaction(client, async () => {
        for (const role of ['platform_admin', 'restaurant_admin', 'diner']) {
          const { rows } = await client.query(
            `INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id`,
            [`db-test-${randomUUID()}@example.com`, role],
          );
          expect(rows).toHaveLength(1);
        }

        const error = await expectDatabaseError(
          client,
          `INSERT INTO users (email, role) VALUES ($1, 'superuser')`,
          [`db-test-${randomUUID()}@example.com`],
        );
        expect(error).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'CHK_users_role',
        });
      });
    });
  });

  describe('POST /v1/restaurants/signup, with the real service and commits', () => {
    const SIGNUPS = 5;
    let dataSource: DataSource;

    beforeAll(async () => {
      dataSource = await openTestDataSource();
    });

    afterAll(async () => {
      await closeTestDataSource(dataSource);
    });

    // Borra solo lo de esta cuenta, en orden de FK: el usuario apunta al
    // restaurante y los horarios también.
    async function cleanUp(uid: string, name: string): Promise<void> {
      await client.query(`DELETE FROM users WHERE firebase_uid = $1`, [uid]);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM restaurants WHERE name = $1`,
        [name],
      );
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await client.query(
          `DELETE FROM restaurant_schedules WHERE restaurant_id = ANY($1::uuid[])`,
          [ids],
        );
        await client.query(
          `DELETE FROM restaurants WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      }
    }

    it(`${SIGNUPS} simultaneous sign-ups of the same account: one users row and one restaurant`, async () => {
      const uid = `db-test-uid-${randomUUID()}`;
      const email = `db-test-${randomUUID()}@example.com`;
      const name = `db-test-${randomUUID()}`;
      const identity: RequestIdentity = {
        kind: 'unregistered',
        firebase: { uid, email, name: null, emailVerified: true },
      };
      const service = new RestaurantSignupService(
        dataSource.getRepository(Restaurant),
        new UsersService(dataSource.getRepository(User)),
      );
      const dto = {
        name,
        category: 'colombian' as const,
        address: 'Calle 72 # 10-34, Bogotá',
        contactPhone: '+573001234567',
        schedules: [{ dayOfWeek: 1, isOpen24h: true }],
      };

      try {
        const results = await Promise.allSettled(
          Array.from({ length: SIGNUPS }, () => service.signup(identity, dto)),
        );

        const won = results.filter((result) => result.status === 'fulfilled');
        const lost = results.filter((result) => result.status === 'rejected');
        process.stdout.write(
          `[signup simultáneo] ganó=${won.length} 409=${lost.length}\n`,
        );
        expect(won).toHaveLength(1);
        for (const result of lost) {
          const reason = (result as PromiseRejectedResult).reason as Error;
          expect(reason).toBeInstanceOf(ConflictException);
          expect(reason.message).toBe(ALREADY_REGISTERED_MESSAGE);
        }

        const { rows: users } = await client.query<{
          role: string;
          restaurant_id: string;
          display_name: string | null;
        }>(
          `SELECT role, restaurant_id, display_name FROM users WHERE firebase_uid = $1 OR email = $2`,
          [uid, email],
        );
        const { rows: restaurants } = await client.query<{
          id: string;
          approval_status: string;
          contact_phone: string;
          reviewed_by: string | null;
        }>(
          `SELECT id, approval_status, contact_phone, reviewed_by FROM restaurants WHERE name = $1`,
          [name],
        );
        const { rows: schedules } = await client.query(
          `SELECT 1 FROM restaurant_schedules WHERE restaurant_id = $1`,
          [restaurants[0]?.id],
        );

        expect(users).toEqual([
          {
            role: 'restaurant_admin',
            restaurant_id: restaurants[0]?.id,
            display_name: null,
          },
        ]);
        expect(restaurants).toEqual([
          {
            id: expect.any(String),
            approval_status: 'pending',
            contact_phone: '+573001234567',
            reviewed_by: null,
          },
        ]);
        expect(schedules).toHaveLength(1);
      } finally {
        await cleanUp(uid, name);
      }
    });
  });
});
