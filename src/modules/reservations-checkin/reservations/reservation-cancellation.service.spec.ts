import type { EventEmitter2 } from '@nestjs/event-emitter';
import { UpdateQueryBuilder, type DataSource } from 'typeorm';
import { createMetadataOnlyDataSource } from '../../../../test/support/typeorm-metadata.js';
import type { CurrentUserData } from '../../identity-access/index.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type TableStatusLog,
} from '../../restaurant-operations/index.js';
import type { Clock } from '../../search-availability/index.js';
import { ReservationCancellationService } from './reservation-cancellation.service.js';
import type { ReservationExpirationService } from './reservation-expiration.service.js';
import {
  RESERVATION_NOT_ACTIVE_MESSAGE,
  RESERVATION_NOT_FOUND_MESSAGE,
} from './reservation-errors.js';
import { Reservation } from './reservation.entity.js';
import type { ReservationViewReader } from './reservation-view.reader.js';

const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const OTHER_DINER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const RESERVATION_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

const user: CurrentUserData = {
  userId: DINER_ID,
  restaurantId: null,
  role: 'diner' as CurrentUserData['role'],
};

const reservation = (overrides: Partial<Reservation> = {}): Reservation =>
  ({
    id: RESERVATION_ID,
    dinerId: DINER_ID,
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    status: 'active',
    expiresAt: new Date('2026-11-05T17:10:00Z'),
    cancelledAt: null,
    ...overrides,
  }) as Reservation;

// Lo que devuelve Postgres para un UPDATE ... RETURNING: filas con EXACTAMENTE
// las columnas del RETURNING del SQL generado, con los nombres de la base.
function postgresRows(sql: string, record: Record<string, unknown>[]) {
  const clause = /RETURNING (.+)$/.exec(sql)?.[1];
  if (!clause) {
    return [];
  }
  const columns = clause.split(',').map((c) => c.trim().replace(/"/g, ''));
  return record.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column]])),
  );
}

interface Options {
  stored?: Reservation[];
  // El UPDATE de la cancelación encuentra la reserva (activa y vigente).
  updateHits?: boolean;
  // El vencimiento previo (expireIfDue) deja la reserva en expired.
  expirationExpires?: boolean;
  // La mesa sigue en reserved (el UPDATE de la mesa afecta una fila).
  tableStillReserved?: boolean;
  logFails?: boolean;
}

let metadataDataSource: DataSource;

beforeAll(async () => {
  metadataDataSource = await createMetadataOnlyDataSource();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(options: Options = {}) {
  const stored = options.stored ?? [reservation()];
  const log: string[] = [];
  const executed: { sql: string; params: unknown[] }[] = [];

  // Query builder REAL de TypeORM (arma el SQL de verdad); solo se corta la ida
  // a la base: execute() registra el SQL y responde como lo haría Postgres.
  vi.spyOn(UpdateQueryBuilder.prototype, 'execute').mockImplementation(
    function (this: UpdateQueryBuilder<Reservation>) {
      const [sql, params] = this.getQueryAndParameters();
      executed.push({ sql, params });
      log.push('update-reservation');
      if (!options.updateHits) {
        return Promise.resolve({ raw: [], affected: 0, generatedMaps: [] });
      }
      const row = stored[0];
      Object.assign(row, { status: 'cancelled', cancelledAt: NOW });
      const raw = postgresRows(sql, [
        {
          id: row.id,
          table_id: row.tableId,
          restaurant_id: row.restaurantId,
        },
      ]);
      return Promise.resolve({ raw, affected: raw.length, generatedMaps: [] });
    } as never,
  );

  const reservationsRepo = {
    findOne: vi.fn(({ where }: { where: { id: string; dinerId: string } }) => {
      log.push('read');
      return Promise.resolve(
        stored.find(
          (row) => row.id === where.id && row.dinerId === where.dinerId,
        ) ?? null,
      );
    }),
  };
  const tablesRepo = {
    update: vi.fn((criteria: Record<string, unknown>) => {
      // TypeORM rechaza un valor undefined en el where: así falló en la base real.
      for (const [property, value] of Object.entries(criteria)) {
        if (value === undefined) {
          throw new Error(
            `Undefined value encountered in property '${property}' of a where condition.`,
          );
        }
      }
      log.push('update-table');
      return Promise.resolve({
        affected: (options.tableStillReserved ?? true) ? 1 : 0,
      });
    }),
  };
  const manager = {
    createQueryBuilder: () => metadataDataSource.createQueryBuilder(),
    getRepository: vi.fn(() => tablesRepo),
  };
  const dataSource = {
    getRepository: vi.fn(() => reservationsRepo),
    transaction: vi.fn(async (work: (m: unknown) => Promise<unknown>) => {
      log.push('begin');
      try {
        const result = await work(manager);
        log.push('commit');
        return result;
      } catch (error) {
        log.push('rollback');
        throw error;
      }
    }),
  };
  const expiration = {
    expireIfDue: vi.fn((id: string) => {
      log.push('expireIfDue');
      if (options.expirationExpires) {
        stored
          .filter((row) => row.id === id)
          .forEach((row) => Object.assign(row, { status: 'expired' }));
      }
      return Promise.resolve(options.expirationExpires ? 1 : 0);
    }),
  };
  const statusLog = {
    record: vi.fn(() => {
      log.push('log');
      return options.logFails
        ? Promise.reject(new Error('log roto'))
        : Promise.resolve();
    }),
  };
  const events = {
    emit: vi.fn(() => {
      log.push('emit');
      return true;
    }),
  };
  const view = {
    toResponse: vi.fn((row: Reservation, serverTime: Date) =>
      Promise.resolve({
        id: row.id,
        status: row.status,
        code: null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        serverTime: serverTime.toISOString(),
      }),
    ),
  };
  const service = new ReservationCancellationService(
    dataSource as unknown as DataSource,
    expiration as unknown as ReservationExpirationService,
    statusLog as unknown as TableStatusLog,
    events as unknown as EventEmitter2,
    view as unknown as ReservationViewReader,
    { now: () => NOW } as Clock,
  );
  return {
    service,
    stored,
    log,
    executed,
    manager,
    dataSource,
    tablesRepo,
    expiration,
    statusLog,
    events,
    view,
  };
}

const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

describe('ReservationCancellationService · éxito', () => {
  it('cancela la reserva, libera la mesa y escribe la bitácora en la misma transacción, con el evento solo después del commit', async () => {
    const t = setup({ updateHits: true });

    const response = await t.service.cancel(user, RESERVATION_ID);

    expect(t.log).toEqual([
      'read',
      'expireIfDue',
      'begin',
      'update-reservation',
      'update-table',
      'log',
      'commit',
      'emit',
      'read',
    ]);
    expect(response).toMatchObject({
      id: RESERVATION_ID,
      status: 'cancelled',
      code: null,
      cancelledAt: NOW.toISOString(),
      serverTime: NOW.toISOString(),
    });
    expect(t.events.emit).toHaveBeenCalledWith(
      RESTAURANT_AVAILABILITY_AFFECTED,
      { restaurantId: RESTAURANT_ID },
    );
  });

  it('la mesa vuelve a available solo si sigue en reserved (la condición va en el UPDATE)', async () => {
    const t = setup({ updateHits: true });

    await t.service.cancel(user, RESERVATION_ID);

    expect(t.tablesRepo.update).toHaveBeenCalledWith(
      { id: TABLE_ID, status: 'reserved' },
      { status: 'available' },
    );
  });

  it('la bitácora lleva source reservation, el comensal como usuario y reserved → available, con el manager de la transacción', async () => {
    const t = setup({ updateHits: true });

    await t.service.cancel(user, RESERVATION_ID);

    expect(t.statusLog.record).toHaveBeenCalledWith(
      {
        tableId: TABLE_ID,
        previousStatus: 'reserved',
        newStatus: 'available',
        userId: DINER_ID,
        source: 'reservation',
        changedAt: NOW,
      },
      t.manager,
    );
  });

  it('el UPDATE lleva la condición completa y la hora del Clock (SQL real de TypeORM)', async () => {
    const t = setup({ updateHits: true });

    await t.service.cancel(user, RESERVATION_ID);

    const [{ sql, params }] = t.executed;
    expect(sql).toMatch(/^UPDATE "reservations" SET /);
    expect(sql).toContain('SET "status" = $1, "cancelled_at" = $2');
    expect(sql).toContain(
      `WHERE "id" = $3 AND "diner_id" = $4 AND "status" = 'active' AND "expires_at" > $5`,
    );
    expect(params).toEqual(['cancelled', NOW, RESERVATION_ID, DINER_ID, NOW]);
  });

  it('pide en el RETURNING, como texto, las columnas que lee: id, table_id y restaurant_id', async () => {
    const t = setup({ updateHits: true });

    await t.service.cancel(user, RESERVATION_ID);

    const [{ sql }] = t.executed;
    expect(sql).toMatch(/RETURNING "id", "table_id", "restaurant_id"$/);
    // Con table_id ausente, la mesa llegaría undefined y el doble de la mesa
    // fallaría como TypeORM: llegar hasta aquí demuestra que la forma es la real.
    expect(t.tablesRepo.update).toHaveBeenCalledTimes(1);
  });

  it('TypeORM: returning([...]) con nombres de columna descartaría table_id (por eso va como texto)', () => {
    const [sql] = metadataDataSource
      .createQueryBuilder()
      .update(Reservation)
      .set({ status: 'cancelled' })
      .where('"id" = :id', { id: RESERVATION_ID })
      .returning(['id', 'table_id', 'restaurant_id'])
      .getQueryAndParameters();

    expect(sql).toMatch(/RETURNING "id"$/);
  });
});

describe('ReservationCancellationService · mesa cambiada a mano', () => {
  it('la reserva queda cancelled pero la mesa NO se pisa: sin bitácora ni evento', async () => {
    const t = setup({ updateHits: true, tableStillReserved: false });

    const response = await t.service.cancel(user, RESERVATION_ID);

    expect(response).toMatchObject({ status: 'cancelled' });
    expect(t.tablesRepo.update).toHaveBeenCalledTimes(1);
    expect(t.statusLog.record).not.toHaveBeenCalled();
    expect(t.events.emit).not.toHaveBeenCalled();
    expect(t.log).toContain('commit');
  });

  it('si la bitácora falla, todo se revierte y no se emite nada', async () => {
    const t = setup({ updateHits: true, logFails: true });

    await expect(t.service.cancel(user, RESERVATION_ID)).rejects.toThrow(
      'log roto',
    );

    expect(t.log).toContain('rollback');
    expect(t.log).not.toContain('commit');
    expect(t.events.emit).not.toHaveBeenCalled();
  });
});

describe('ReservationCancellationService · 404', () => {
  it('la reserva de otro comensal y un id inexistente dan el mismo 404, sin vencer ni abrir transacción', async () => {
    const t = setup({
      stored: [
        reservation({
          dinerId: OTHER_DINER_ID,
          expiresAt: new Date('2026-11-05T16:00:00Z'),
        }),
      ],
    });

    const ofOther = await errorOf(t.service.cancel(user, RESERVATION_ID));
    const unknown = await errorOf(t.service.cancel(user, UNKNOWN_ID));

    expect(ofOther).toMatchObject({
      status: 404,
      response: {
        errorCode: 'RESERVATION_NOT_FOUND',
        message: RESERVATION_NOT_FOUND_MESSAGE,
      },
    });
    expect(unknown).toEqual(ofOther);
    // Nunca se vence la reserva de un tercero solo por conocer su id.
    expect(t.expiration.expireIfDue).not.toHaveBeenCalled();
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
    expect(t.events.emit).not.toHaveBeenCalled();
  });

  it('busca solo entre las reservas del comensal de la sesión', async () => {
    const t = setup();

    await t.service.cancel(user, RESERVATION_ID).catch(() => undefined);

    expect(t.dataSource.getRepository).toHaveBeenCalledWith(Reservation);
  });
});

describe('ReservationCancellationService · 409 RESERVATION_NOT_ACTIVE', () => {
  it.each(['cancelled', 'expired', 'completed'] as const)(
    'una reserva %s responde 409 con su errorCode y mensaje, sin transacción ni vencimiento',
    async (status) => {
      const t = setup({ stored: [reservation({ status })] });

      const error = await errorOf(t.service.cancel(user, RESERVATION_ID));

      expect(error).toMatchObject({
        status: 409,
        response: {
          errorCode: 'RESERVATION_NOT_ACTIVE',
          message: RESERVATION_NOT_ACTIVE_MESSAGE,
        },
      });
      expect((error as Error).message).toBe('Esta reserva ya no está activa.');
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
      expect(t.expiration.expireIfDue).not.toHaveBeenCalled();
      expect(t.events.emit).not.toHaveBeenCalled();
    },
  );

  it('una activa ya vencida sin barrer: se vence ANTES de abrir la transacción y responde 409', async () => {
    const t = setup({
      stored: [reservation({ expiresAt: new Date('2026-11-05T16:59:00Z') })],
      expirationExpires: true,
      updateHits: false,
    });

    const error = await errorOf(t.service.cancel(user, RESERVATION_ID));

    expect(error).toMatchObject({
      response: { errorCode: 'RESERVATION_NOT_ACTIVE' },
    });
    expect(t.expiration.expireIfDue).toHaveBeenCalledWith(RESERVATION_ID);
    expect(t.log.indexOf('expireIfDue')).toBeLessThan(t.log.indexOf('begin'));
    // La liberación de la mesa fue del vencimiento: la cancelación no la repite.
    expect(t.tablesRepo.update).not.toHaveBeenCalled();
    expect(t.statusLog.record).not.toHaveBeenCalled();
    expect(t.events.emit).not.toHaveBeenCalled();
  });

  it('otra operación se adelantó entre la lectura y el UPDATE (ya cancelada): 409 sin tocar la mesa', async () => {
    const t = setup({ updateHits: false });
    t.expiration.expireIfDue.mockImplementation(() => {
      // Mientras tanto, otra cancelación ganó.
      t.stored[0].status = 'cancelled';
      return Promise.resolve(0);
    });

    const error = await errorOf(t.service.cancel(user, RESERVATION_ID));

    expect(error).toMatchObject({
      response: { errorCode: 'RESERVATION_NOT_ACTIVE' },
    });
    expect(t.tablesRepo.update).not.toHaveBeenCalled();
    expect(t.statusLog.record).not.toHaveBeenCalled();
  });

  it('el UPDATE no la encuentra porque venció entre medias y sigue active: se vence ahora y responde 409', async () => {
    const t = setup({ updateHits: false });

    const error = await errorOf(t.service.cancel(user, RESERVATION_ID));

    expect(error).toMatchObject({
      response: { errorCode: 'RESERVATION_NOT_ACTIVE' },
    });
    // Una vez antes de transaccionar y otra tras el UPDATE sin fila.
    expect(t.expiration.expireIfDue).toHaveBeenCalledTimes(2);
  });

  it('el UPDATE no encuentra fila y la reserva ya no existe: 404', async () => {
    const t = setup({ updateHits: false });
    t.expiration.expireIfDue.mockImplementation(() => {
      t.stored.length = 0;
      return Promise.resolve(0);
    });

    // La primera lectura la vio; la segunda (tras el UPDATE) ya no existe.
    const error = await errorOf(t.service.cancel(user, RESERVATION_ID));

    expect(error).toMatchObject({
      status: 404,
      response: { errorCode: 'RESERVATION_NOT_FOUND' },
    });
  });
});
