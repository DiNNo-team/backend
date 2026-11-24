import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

// Datos propios de las pruebas del panel del administrador contra Postgres
// REAL. Con commits (los servicios usan su propio pool y no ven una transacción
// abierta del cliente de la prueba): cada fábrica registra lo que crea y
// cleanup() lo borra en orden de FK, aunque la prueba falle. La base de pruebas
// es una copia de datos reales: nunca se toca nada que no se haya creado aquí,
// y las sumas de toda la plataforma se comprueban por diferencia (antes/después).

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join('');
}

export class AdminFixtures {
  private readonly restaurants: string[] = [];
  private readonly users: string[] = [];

  constructor(private readonly client: Client) {}

  async restaurant(
    approvalStatus: 'approved' | 'pending' | 'suspended' = 'approved',
  ): Promise<string> {
    const admin = approvalStatus === 'suspended' ? await this.admin() : null;
    const { rows } = await this.client.query<{ id: string }>(
      `INSERT INTO restaurants (name, approval_status, suspension_reason, suspended_at, suspended_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        `db-test-admin-${randomUUID()}`,
        approvalStatus,
        admin ? 'Motivo de prueba de la suspensión.' : null,
        admin ? new Date() : null,
        admin,
      ],
    );
    this.restaurants.push(rows[0].id);
    return rows[0].id;
  }

  async admin(): Promise<string> {
    return this.user('platform_admin');
  }

  async user(role: 'platform_admin' | 'diner'): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `INSERT INTO users (email, role) VALUES ($1, $2) RETURNING id`,
      [`db-test-admin-${randomUUID()}@dinno.test`, role],
    );
    this.users.push(rows[0].id);
    return rows[0].id;
  }

  async table(restaurantId: string): Promise<string> {
    const { rows } = await this.client.query<{ id: string }>(
      `INSERT INTO tables (restaurant_id, identifier, capacity, status, is_active)
       VALUES ($1, $2, 4, 'available', true) RETURNING id`,
      [restaurantId, randomUUID().slice(0, 8)],
    );
    return rows[0].id;
  }

  // A finished reservation (never active: it blocks nothing) and, if it was
  // completed, its billable check-in with the given fee.
  async reservation(
    restaurantId: string,
    status: 'completed' | 'cancelled' | 'expired',
    at: Date,
    feeCop = 2000,
    partySize = 2,
  ): Promise<void> {
    const diner = await this.user('diner');
    const table = await this.table(restaurantId);
    const { rows } = await this.client.query<{ id: string }>(
      `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at, created_at,
                                 checked_in_at, cancelled_at, expired_at, no_show)
       VALUES ($1, $2, $12, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        randomCode(),
        status,
        diner,
        restaurantId,
        table,
        new Date(at.getTime() + 15 * 60_000),
        at,
        status === 'completed' ? at : null,
        status === 'cancelled' ? at : null,
        status === 'expired' ? at : null,
        status === 'expired',
        partySize,
      ],
    );
    if (status === 'completed') {
      await this.client.query(
        `INSERT INTO check_ins (reservation_id, restaurant_id, checked_in_at, fee_cop) VALUES ($1, $2, $3, $4)`,
        [rows[0].id, restaurantId, at, feeCop],
      );
    }
  }

  async cleanup(): Promise<void> {
    const steps: [string, unknown[]][] = [
      [
        `DELETE FROM billing_periods WHERE restaurant_id = ANY($1::uuid[]) OR marked_paid_by = ANY($2::uuid[])`,
        [this.restaurants, this.users],
      ],
      [
        `DELETE FROM check_ins WHERE restaurant_id = ANY($1::uuid[])`,
        [this.restaurants],
      ],
      [
        `DELETE FROM reservations WHERE restaurant_id = ANY($1::uuid[])`,
        [this.restaurants],
      ],
      [
        `DELETE FROM table_logs WHERE table_id IN (SELECT id FROM tables WHERE restaurant_id = ANY($1::uuid[]))`,
        [this.restaurants],
      ],
      [
        `DELETE FROM tables WHERE restaurant_id = ANY($1::uuid[])`,
        [this.restaurants],
      ],
      [
        `DELETE FROM restaurants WHERE id = ANY($1::uuid[])`,
        [this.restaurants],
      ],
      [`DELETE FROM users WHERE id = ANY($1::uuid[])`, [this.users]],
    ];
    let firstError: unknown;
    for (const [sql, params] of steps) {
      try {
        await this.client.query(sql, params);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) {
      throw firstError;
    }
  }
}
