import { randomInt, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Scenario } from './scenario.js';

// Datos propios para las pruebas de los scripts de datos (export:data y
// demo:reset). Todo cuelga de un Scenario, así que su borrado los limpia.

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// Código válido al azar: el índice único solo cuenta las reservas activas, y
// la base de pruebas es una copia de datos reales.
export function randomCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}

export type ReservationState = 'active' | 'cancelled' | 'expired' | 'completed';

interface ReservationInsert {
  dinerId: string;
  tableId: string;
  state: ReservationState;
  // Minutos desde ahora para created_at (negativo = en el pasado).
  createdMinutesAgo?: number;
}

export interface InsertedReservation {
  id: string;
  code: string;
}

// Inserta una reserva en el estado pedido, con las columnas de cierre que le
// corresponden.
export async function insertReservation(
  dataSource: DataSource,
  scenario: Scenario,
  { dinerId, tableId, state, createdMinutesAgo = 30 }: ReservationInsert,
): Promise<InsertedReservation> {
  const code = randomCode();
  const created = `now() - interval '${createdMinutesAgo} minutes'`;
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations
       (code, status, party_size, diner_id, restaurant_id, table_id, created_at,
        expires_at, cancelled_at, expired_at, checked_in_at, no_show)
     VALUES ($1, $2::varchar, 2, $3, $4, $5, ${created},
        CASE WHEN $2::varchar = 'active' THEN now() + interval '15 minutes' ELSE ${created} + interval '15 minutes' END,
        CASE WHEN $2::varchar = 'cancelled' THEN ${created} + interval '2 minutes' END,
        CASE WHEN $2::varchar = 'expired' THEN ${created} + interval '15 minutes' END,
        CASE WHEN $2::varchar = 'completed' THEN ${created} + interval '5 minutes' END,
        $2::varchar = 'expired')
     RETURNING id`,
    [code, state, dinerId, scenario.restaurantId, tableId],
  );
  return { id, code };
}

export async function insertCheckIn(
  dataSource: DataSource,
  scenario: Scenario,
  reservationId: string,
): Promise<string> {
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO check_ins (reservation_id, restaurant_id, checked_in_at)
     VALUES ($1, $2, now()) RETURNING id`,
    [reservationId, scenario.restaurantId],
  );
  return id;
}

// Un restaurant_admin propio, registrado en el escenario para que su borrado
// también lo elimine (después de la bitácora que lo referencia).
export async function insertAdmin(
  dataSource: DataSource,
  scenario: Scenario,
): Promise<{ id: string; email: string }> {
  const email = `db-test-admin-${randomUUID()}@example.com`;
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO users (email, role) VALUES ($1, 'restaurant_admin') RETURNING id`,
    [email],
  );
  scenario.dinerIds.push(id);
  return { id, email };
}

export async function insertTableLog(
  dataSource: DataSource,
  tableId: string,
  log: {
    previous: string;
    next: string;
    source: 'manual' | 'reservation' | 'system';
    userId: string | null;
  },
): Promise<void> {
  await dataSource.query(
    `INSERT INTO table_logs (table_id, previous_status, new_status, user_id, source, changed_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [tableId, log.previous, log.next, log.userId, log.source],
  );
}
