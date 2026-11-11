import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DataSource, EntityManager } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { CheckInService } from '../../src/modules/reservations-checkin/check-ins/check-in.service.js';
import { CreateReservationService } from '../../src/modules/reservations-checkin/reservations/create-reservation.service.js';
import { ReservationCancellationService } from '../../src/modules/reservations-checkin/reservations/reservation-cancellation.service.js';
import { RandomCodeGenerator } from '../../src/modules/reservations-checkin/reservations/reservation-code.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { ReservationQueryService } from '../../src/modules/reservations-checkin/reservations/reservation-query.service.js';
import { ReservationViewReader } from '../../src/modules/reservations-checkin/reservations/reservation-view.reader.js';
import { TableStatusLog } from '../../src/modules/restaurant-operations/index.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import type { TableStatusChange } from '../../src/modules/restaurant-operations/tables/table-status-log.js';
import {
  AvailabilityService,
  type Clock,
} from '../../src/modules/search-availability/index.js';
import {
  closeTestDataSource,
  createScenario,
  deleteScenario,
  openTestDataSource,
  reservationLabels,
  withScenario as withSharedScenario,
  type Scenario,
  type TableSeed,
} from './support/scenario.js';

// Eventos internos del tiempo real (Sprint 3, tarea 8; CLAUDE.md §12.8) contra
// Postgres REAL, con los servicios reales y un emisor espía: salen después del
// commit, en la cantidad exacta, y ninguno si la transacción falla. Commits reales
// (sin ROLLBACK): cada prueba crea sus datos y borra SOLO lo que creó (ver
// support/scenario.ts).

// Viernes 2026-11-06 12:00 en Bogotá. Todo lo que no es el barrido tiene alcance
// (reserva, comensal, mesa o restaurante), así que solo toca datos de la prueba.
const NOW = new Date('2026-11-06T17:00:00Z');
const CLOCK = { now: () => NOW } as Clock;
// expireAllDue es GLOBAL: con el reloj en 2020 solo son debidas las reservas con
// expires_at anterior a esa fecha, es decir, las que crea esta suite (el mismo
// truco de reservations-auto-expiry.db-spec.ts).
const SWEEP_NOW = new Date('2020-03-06T17:00:00Z');
const SWEEP_CLOCK = { now: () => SWEEP_NOW } as Clock;

const AVAILABILITY = 'restaurant.availability-affected';
const TABLE_CHANGED = 'table.status-changed';
const COMMIT = 'commit';

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

const withScenario = (
  tables: TableSeed[],
  dinerCount: number,
  work: (scenario: Scenario) => Promise<void>,
) => withSharedScenario(dataSource, tables, dinerCount, work);

interface Emitted {
  name: string;
  payload: Record<string, unknown>;
}

// El emisor espía y el diario: cada COMMIT real (la promesa de transaction ya
// resolvió) y cada evento, en orden. Si un evento saliera dentro de la
// transacción, aparecería antes de su commit.
function spy() {
  const journal: string[] = [];
  const emitted: Emitted[] = [];
  const events = new EventEmitter2();
  events.onAny((name, payload) => {
    journal.push(String(name));
    emitted.push({
      name: String(name),
      payload: payload as Record<string, unknown>,
    });
  });
  const source = new Proxy(dataSource, {
    get(target, property) {
      if (property === 'transaction') {
        return async (...args: unknown[]) => {
          const result: unknown = await (
            target.transaction as (...a: unknown[]) => Promise<unknown>
          ).apply(target, args);
          journal.push(COMMIT);
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { journal, emitted, events, source };
}

// Escribe de verdad la fila y luego falla, como un insert que revienta: la
// transacción debe revertir todo.
class FailingStatusLog extends TableStatusLog {
  private readonly real = new DbTableStatusLog();

  constructor(private readonly failOnCall = 1) {
    super();
  }

  private calls = 0;

  async record(
    change: TableStatusChange,
    manager: EntityManager,
  ): Promise<void> {
    await this.real.record(change, manager);
    this.calls += 1;
    if (this.calls >= this.failOnCall) {
      throw new Error('bitácora rota a propósito');
    }
  }
}

function buildServices(
  options: { statusLog?: TableStatusLog; clock?: Clock } = {},
) {
  const { journal, emitted, events, source } = spy();
  const statusLog = options.statusLog ?? new DbTableStatusLog();
  const clock = options.clock ?? CLOCK;
  const expiration = new ReservationExpirationService(
    source,
    statusLog,
    events,
    clock,
  );
  const labels = reservationLabels(dataSource);
  const view = new ReservationViewReader(dataSource);
  return {
    journal,
    emitted,
    expiration,
    creation: new CreateReservationService(
      source,
      new AvailabilityService(dataSource, clock),
      statusLog,
      events,
      clock,
      new RandomCodeGenerator(),
      { ttlMinutes: 15 },
      expiration,
      labels,
    ),
    cancellation: new ReservationCancellationService(
      source,
      expiration,
      statusLog,
      events,
      view,
      clock,
    ),
    checkIns: new CheckInService(
      source,
      expiration,
      statusLog,
      labels,
      clock,
      events,
    ),
    queries: new ReservationQueryService(source, expiration, view, clock),
  };
}

const asDiner = (userId: string) => ({
  userId,
  restaurantId: null,
  role: UserRole.DINER,
  restaurantApproval: null,
});
const asAdmin = (userId: string, restaurantId: string) => ({
  userId,
  restaurantId,
  role: UserRole.RESTAURANT_ADMIN,
  restaurantApproval: 'approved' as const,
});

// Reserva activa y su mesa reserved, escritas directo: no generan eventos.
async function insertActive(
  scenario: Scenario,
  options: { dinerId: string; tableIdentifier: string; expiresAt: Date },
): Promise<{ id: string; code: string; tableId: string }> {
  const tableId = scenario.tableIds.get(options.tableIdentifier) as string;
  const code = randomCode();
  const [{ id }] = await dataSource.query<{ id: string }[]>(
    `INSERT INTO reservations (code, status, party_size, diner_id, restaurant_id, table_id, expires_at)
     VALUES ($1, 'active', 2, $2, $3, $4, $5) RETURNING id`,
    [code, options.dinerId, scenario.restaurantId, tableId, options.expiresAt],
  );
  await dataSource.query(
    `UPDATE tables SET status = 'reserved' WHERE id = $1`,
    [tableId],
  );
  return { id, code, tableId };
}

function randomCode(): string {
  return new RandomCodeGenerator().generate();
}

const namesOf = (emitted: Emitted[]) => emitted.map(({ name }) => name);

// Todo evento está después del último commit de la operación.
function expectAfterLastCommit(journal: string[]): void {
  const firstEvent = journal.findIndex((entry) => entry !== COMMIT);
  expect(firstEvent).toBeGreaterThan(-1);
  expect(journal.lastIndexOf(COMMIT)).toBeLessThan(firstEvent);
}

const tableStatus = async (tableId: string) => {
  const [{ status }] = await dataSource.query<{ status: string }[]>(
    `SELECT status FROM tables WHERE id = $1`,
    [tableId],
  );
  return status;
};

describe('Eventos del tiempo real contra Postgres real', () => {
  it('crear: reservation.created sin código, table.status_changed y disponibilidad, una vez cada uno y después del commit', async () => {
    await withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
      const t = buildServices();

      const response = await t.creation.create(asDiner(s.dinerIds[0]), {
        restaurantId: s.restaurantId,
        partySize: 2,
      });

      expect(namesOf(t.emitted)).toEqual([
        'reservation.created',
        TABLE_CHANGED,
        AVAILABILITY,
      ]);
      expectAfterLastCommit(t.journal);
      const tableId = s.tableIds.get('01');
      const [created, tableChanged] = t.emitted;
      expect(created.payload).toEqual({
        restaurantId: s.restaurantId,
        reservation: {
          id: response.id,
          status: 'active',
          partySize: 2,
          dinerName: 'Comensal 1',
          tableId,
          tableIdentifier: '01',
          createdAt: expect.any(String) as string,
          expiresAt: response.expiresAt,
          serverTime: NOW.toISOString(),
        },
      });
      expect(JSON.stringify(created.payload)).not.toContain(
        response.code as string,
      );
      expect(tableChanged.payload).toEqual({
        restaurantId: s.restaurantId,
        tableId,
        previousStatus: 'available',
        status: 'reserved',
        source: 'reservation',
      });
    });
  }, 60_000);

  it('cancelar: reservation.cancelled, table.status_changed y disponibilidad, después del commit', async () => {
    await withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
      const dinerId = s.dinerIds[0];
      const { id, tableId } = await insertActive(s, {
        dinerId,
        tableIdentifier: '01',
        expiresAt: new Date(NOW.getTime() + 600_000),
      });
      const t = buildServices();

      await t.cancellation.cancel(asDiner(dinerId), id);

      expect(namesOf(t.emitted)).toEqual([
        'reservation.cancelled',
        TABLE_CHANGED,
        AVAILABILITY,
      ]);
      expectAfterLastCommit(t.journal);
      expect(t.emitted[0].payload).toEqual({
        restaurantId: s.restaurantId,
        dinerId,
        reservationId: id,
        status: 'cancelled',
        tableId,
        at: NOW.toISOString(),
      });
      expect(t.emitted[1].payload).toMatchObject({
        previousStatus: 'reserved',
        status: 'available',
        source: 'reservation',
      });
    });
  }, 60_000);

  it('check-in: reservation.checked_in y table.status_changed, sin disponibilidad, después del commit', async () => {
    await withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
      const dinerId = s.dinerIds[0];
      const { id, code, tableId } = await insertActive(s, {
        dinerId,
        tableIdentifier: '01',
        expiresAt: new Date(NOW.getTime() + 600_000),
      });
      const t = buildServices();

      await t.checkIns.checkIn(asAdmin(dinerId, s.restaurantId), code);

      expect(namesOf(t.emitted)).toEqual([
        'reservation.checked_in',
        TABLE_CHANGED,
      ]);
      expectAfterLastCommit(t.journal);
      expect(t.emitted[0].payload).toMatchObject({
        reservationId: id,
        dinerId,
        status: 'completed',
        at: NOW.toISOString(),
      });
      expect(t.emitted[1].payload).toMatchObject({
        tableId,
        previousStatus: 'reserved',
        status: 'occupied',
        source: 'reservation',
      });
      await expect(tableStatus(tableId)).resolves.toBe('occupied');
    });
  }, 60_000);

  it('vencer al leer: reservation.expired, table.status_changed con source system y disponibilidad', async () => {
    await withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
      const dinerId = s.dinerIds[0];
      const { id, tableId } = await insertActive(s, {
        dinerId,
        tableIdentifier: '01',
        expiresAt: new Date(NOW.getTime() - 60_000),
      });
      const t = buildServices();

      await expect(
        t.queries.findActive(asDiner(dinerId)),
      ).resolves.toMatchObject({ reservation: null });

      expect(namesOf(t.emitted)).toEqual([
        'reservation.expired',
        TABLE_CHANGED,
        AVAILABILITY,
      ]);
      expectAfterLastCommit(t.journal);
      expect(t.emitted[0].payload).toMatchObject({
        reservationId: id,
        dinerId,
        restaurantId: s.restaurantId,
        status: 'expired',
        tableId,
      });
      expect(t.emitted[1].payload).toMatchObject({ source: 'system' });
    });
  }, 60_000);

  it('una mesa cambiada a mano: la reserva vence y avisa, pero sin table.status_changed ni disponibilidad', async () => {
    await withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
      const dinerId = s.dinerIds[0];
      const { tableId } = await insertActive(s, {
        dinerId,
        tableIdentifier: '01',
        expiresAt: new Date(NOW.getTime() - 60_000),
      });
      await dataSource.query(
        `UPDATE tables SET status = 'occupied' WHERE id = $1`,
        [tableId],
      );
      const t = buildServices();

      await t.expiration.expireDueForDiner(dinerId);

      expect(namesOf(t.emitted)).toEqual(['reservation.expired']);
      await expect(tableStatus(tableId)).resolves.toBe('occupied');
    });
  }, 60_000);

  it('expireAllDue con varias reservas en dos restaurantes: la cantidad exacta y solo después del commit', async () => {
    const tables = [
      { identifier: '01', capacity: 4 },
      { identifier: '02', capacity: 4 },
    ];
    const due = new Date(SWEEP_NOW.getTime() - 60_000);
    const first = await createScenario(dataSource, tables, 2);
    const second = await createScenario(dataSource, tables, 1);
    try {
      const a1 = await insertActive(first, {
        dinerId: first.dinerIds[0],
        tableIdentifier: '01',
        expiresAt: due,
      });
      const a2 = await insertActive(first, {
        dinerId: first.dinerIds[1],
        tableIdentifier: '02',
        expiresAt: due,
      });
      const b1 = await insertActive(second, {
        dinerId: second.dinerIds[0],
        tableIdentifier: '01',
        expiresAt: due,
      });
      const t = buildServices({ clock: SWEEP_CLOCK });

      await expect(t.expiration.expireAllDue()).resolves.toBe(3);

      expectAfterLastCommit(t.journal);
      const ofKind = (name: string) =>
        t.emitted.filter((event) => event.name === name);
      expect(
        ofKind('reservation.expired')
          .map(({ payload }) => payload.reservationId as string)
          .sort(),
      ).toEqual([a1.id, a2.id, b1.id].sort());
      expect(
        ofKind(TABLE_CHANGED)
          .map(({ payload }) => payload.tableId as string)
          .sort(),
      ).toEqual([a1.tableId, a2.tableId, b1.tableId].sort());
      for (const { payload } of ofKind(TABLE_CHANGED)) {
        expect(payload).toMatchObject({
          previousStatus: 'reserved',
          status: 'available',
          source: 'system',
        });
      }
      // Cada evento lleva el restaurante correcto, para elegir la sala.
      const restaurantOf = new Map([
        [a1.id, first.restaurantId],
        [a2.id, first.restaurantId],
        [b1.id, second.restaurantId],
      ]);
      for (const { payload } of ofKind('reservation.expired')) {
        expect(payload.restaurantId).toBe(
          restaurantOf.get(payload.reservationId as string),
        );
      }
      // Disponibilidad: una vez por restaurante, no por reserva.
      expect(
        ofKind(AVAILABILITY)
          .map(({ payload }) => payload.restaurantId as string)
          .sort(),
      ).toEqual([first.restaurantId, second.restaurantId].sort());
    } finally {
      await deleteScenario(dataSource, first);
      await deleteScenario(dataSource, second);
    }
  }, 120_000);

  it('una transacción de creación que falla: cero eventos, y ni reserva ni mesa cambiada', async () => {
    await withScenario([{ identifier: '01', capacity: 4 }], 1, async (s) => {
      const t = buildServices({ statusLog: new FailingStatusLog() });

      await expect(
        t.creation.create(asDiner(s.dinerIds[0]), {
          restaurantId: s.restaurantId,
          partySize: 2,
        }),
      ).rejects.toThrow('bitácora rota a propósito');

      expect(t.emitted).toEqual([]);
      await expect(tableStatus(s.tableIds.get('01') as string)).resolves.toBe(
        'available',
      );
      const [{ count }] = await dataSource.query<{ count: string }[]>(
        `SELECT count(*) FROM reservations WHERE restaurant_id = $1`,
        [s.restaurantId],
      );
      expect(count).toBe('0');
    });
  }, 60_000);

  it('un lote que falla a mitad: se revierte completo y sin eventos, tampoco de las reservas que alcanzó a procesar', async () => {
    const due = new Date(SWEEP_NOW.getTime() - 60_000);
    await withScenario(
      [
        { identifier: '01', capacity: 4 },
        { identifier: '02', capacity: 4 },
      ],
      2,
      async (s) => {
        const first = await insertActive(s, {
          dinerId: s.dinerIds[0],
          tableIdentifier: '01',
          expiresAt: due,
        });
        const second = await insertActive(s, {
          dinerId: s.dinerIds[1],
          tableIdentifier: '02',
          expiresAt: due,
        });
        // La primera fila se escribe; la segunda revienta.
        const t = buildServices({
          clock: SWEEP_CLOCK,
          statusLog: new FailingStatusLog(2),
        });

        await expect(t.expiration.expireAllDue()).rejects.toThrow(
          'bitácora rota a propósito',
        );

        expect(t.emitted).toEqual([]);
        await expect(tableStatus(first.tableId)).resolves.toBe('reserved');
        await expect(tableStatus(second.tableId)).resolves.toBe('reserved');
      },
    );
  }, 60_000);
});
