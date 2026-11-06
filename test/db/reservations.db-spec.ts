import type { Client } from 'pg';
import {
  assertMigrationsApplied,
  CHECK_VIOLATION,
  connectTestDatabase,
  expectDatabaseError,
  inRolledBackTransaction,
  insertReservation,
  insertRestaurant,
  insertTable,
  insertUser,
  UNIQUE_VIOLATION,
} from './support/test-db.js';

// Pruebas del esquema de microreservas contra Postgres REAL (Sprint 3,
// tarea 1). Cada prueba corre en una transacción que termina en ROLLBACK.
let client: Client;

beforeAll(async () => {
  client = await connectTestDatabase();
  await assertMigrationsApplied(client);
});

afterAll(async () => {
  await client?.end();
});

// Un restaurante con dos mesas y dos comensales, para armar los conflictos.
async function scenario() {
  const restaurantId = await insertRestaurant(client);
  return {
    restaurantId,
    tableA: await insertTable(client, restaurantId),
    tableB: await insertTable(client, restaurantId),
    dinerA: await insertUser(client),
    dinerB: await insertUser(client),
  };
}

describe('reservations: índices únicos parciales', () => {
  it('rechaza una segunda reserva active en la misma mesa', () =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      await insertReservation(client, {
        ...s,
        tableId: s.tableA,
        dinerId: s.dinerA,
        code: 'AAAAAA',
      });

      const error = await expectDatabaseError(
        client,
        `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
         VALUES ('BBBBBB', 'active', 2, $1, $2, $3, now())`,
        [s.dinerB, s.restaurantId, s.tableA],
      );

      expect(error.code).toBe(UNIQUE_VIOLATION);
      expect(error.constraint).toBe('UQ_reservations_active_table');
    }));

  it('rechaza una segunda reserva active del mismo comensal', () =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      await insertReservation(client, {
        ...s,
        tableId: s.tableA,
        dinerId: s.dinerA,
        code: 'AAAAAA',
      });

      const error = await expectDatabaseError(
        client,
        `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
         VALUES ('BBBBBB', 'active', 2, $1, $2, $3, now())`,
        [s.dinerA, s.restaurantId, s.tableB],
      );

      expect(error.code).toBe(UNIQUE_VIOLATION);
      expect(error.constraint).toBe('UQ_reservations_active_diner');
    }));

  it('rechaza un segundo código igual entre reservas active', () =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      await insertReservation(client, {
        ...s,
        tableId: s.tableA,
        dinerId: s.dinerA,
        code: 'AAAAAA',
      });

      const error = await expectDatabaseError(
        client,
        `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
         VALUES ('AAAAAA', 'active', 2, $1, $2, $3, now())`,
        [s.dinerB, s.restaurantId, s.tableB],
      );

      expect(error.code).toBe(UNIQUE_VIOLATION);
      expect(error.constraint).toBe('UQ_reservations_active_code');
    }));

  it.each(['cancelled', 'expired', 'completed'])(
    'acepta mesa, comensal y código repetidos cuando la reserva anterior está %s',
    (status) =>
      inRolledBackTransaction(client, async () => {
        const s = await scenario();
        await insertReservation(client, {
          ...s,
          tableId: s.tableA,
          dinerId: s.dinerA,
          code: 'AAAAAA',
          status,
        });
        await insertReservation(client, {
          ...s,
          tableId: s.tableA,
          dinerId: s.dinerA,
          code: 'AAAAAA',
          status,
        });

        // Y también una active nueva con los mismos datos que las cerradas.
        await insertReservation(client, {
          ...s,
          tableId: s.tableA,
          dinerId: s.dinerA,
          code: 'AAAAAA',
        });

        const { rows } = await client.query(
          `SELECT status FROM reservations WHERE table_id = $1`,
          [s.tableA],
        );
        expect(rows).toHaveLength(3);
      }),
  );
});

describe('reservations: checks', () => {
  it('rechaza un estado inválido', () =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      const error = await expectDatabaseError(
        client,
        `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
         VALUES ('AAAAAA', 'pending', 2, $1, $2, $3, now())`,
        [s.dinerA, s.restaurantId, s.tableA],
      );

      expect(error.code).toBe(CHECK_VIOLATION);
      expect(error.constraint).toBe('CHK_reservations_status');
    }));

  it.each([0, 21])('rechaza party_size %i', (partySize) =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      const error = await expectDatabaseError(
        client,
        `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
         VALUES ('AAAAAA', 'active', $4, $1, $2, $3, now())`,
        [s.dinerA, s.restaurantId, s.tableA, partySize],
      );

      expect(error.constraint).toBe('CHK_reservations_party_size');
    }),
  );

  it.each([
    ['con el 0', 'K7M4Q0'],
    ['con la O', 'K7M4QO'],
    ['con el 1', 'K7M4Q1'],
    ['con la I', 'K7M4QI'],
    ['con la L', 'K7M4QL'],
    ['en minúsculas', 'k7m4qx'],
    ['de 5 caracteres', 'K7M4Q'],
    ['de 7 caracteres', 'K7M4QXX'],
  ])('rechaza un código %s', (_label, code) =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      const error = await expectDatabaseError(
        client,
        `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
         VALUES ($4, 'active', 2, $1, $2, $3, now())`,
        [s.dinerA, s.restaurantId, s.tableA, code],
      );

      // El de 7 caracteres falla antes por el varchar(6); los demás, por el check.
      expect(['22001', CHECK_VIOLATION]).toContain(error.code);
    }),
  );

  it('acepta un código válido y deja no_show en false por defecto', () =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      const id = await insertReservation(client, {
        ...s,
        tableId: s.tableA,
        dinerId: s.dinerA,
        code: 'K7M4QX',
      });

      const { rows } = await client.query<{ no_show: boolean }>(
        `SELECT no_show FROM reservations WHERE id = $1`,
        [id],
      );
      expect(rows[0].no_show).toBe(false);
    }));
});

describe('check_ins', () => {
  it('rechaza dos registros para la misma reserva', () =>
    inRolledBackTransaction(client, async () => {
      const s = await scenario();
      const reservationId = await insertReservation(client, {
        ...s,
        tableId: s.tableA,
        dinerId: s.dinerA,
      });
      await client.query(
        `INSERT INTO check_ins (reservation_id, restaurant_id, checked_in_at) VALUES ($1, $2, now())`,
        [reservationId, s.restaurantId],
      );

      const error = await expectDatabaseError(
        client,
        `INSERT INTO check_ins (reservation_id, restaurant_id, checked_in_at) VALUES ($1, $2, now())`,
        [reservationId, s.restaurantId],
      );

      expect(error.code).toBe(UNIQUE_VIOLATION);
      expect(error.constraint).toBe('UQ_check_ins_reservation_id');
    }));
});
