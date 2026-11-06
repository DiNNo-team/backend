import { UpdateQueryBuilder, type DataSource } from 'typeorm';
import { createMetadataOnlyDataSource } from '../../../../test/support/typeorm-metadata.js';
import type { CurrentUserData } from '../../identity-access/index.js';
import type { TableStatusLog } from '../../restaurant-operations/index.js';
import type { Clock } from '../../search-availability/index.js';
import type { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import { Reservation } from '../reservations/reservation.entity.js';
import { CheckIn } from './check-in.entity.js';
import { CheckInService } from './check-in.service.js';
import { RESERVATION_CODE_NOT_FOUND_MESSAGE } from './check-in-errors.js';
import type { ReservationLabelsReader } from './reservation-labels.reader.js';

const ADMIN_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const RESERVATION_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const OLD_RESERVATION_ID = '11111111-1111-4111-8111-111111111111';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const OTHER_RESTAURANT_ID = '66cc1593-cf2f-4a1c-8ca9-8644446e069c';
const TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const CODE = 'K7M4QX';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

const admin: CurrentUserData = {
  userId: ADMIN_ID,
  restaurantId: RESTAURANT_ID,
  role: 'restaurant_admin' as CurrentUserData['role'],
};

const reservation = (overrides: Partial<Reservation> = {}): Reservation =>
  ({
    id: RESERVATION_ID,
    code: CODE,
    status: 'active',
    partySize: 2,
    dinerId: DINER_ID,
    restaurantId: RESTAURANT_ID,
    tableId: TABLE_ID,
    createdAt: new Date('2026-11-05T16:50:00Z'),
    expiresAt: new Date('2026-11-05T17:05:00Z'),
    checkedInAt: null,
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
  updateHits?: boolean;
  tableStillReserved?: boolean;
  logFails?: boolean;
  checkInInsertFails?: boolean;
  dinerName?: string | null;
  // Qué le pasa a la reserva mientras la transacción pierde la carrera.
  afterLostUpdate?: (row: Reservation) => void;
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
      const row = stored.find((r) => r.status === 'active') ?? stored[0];
      if (!(options.updateHits ?? true)) {
        options.afterLostUpdate?.(row);
        return Promise.resolve({ raw: [], affected: 0, generatedMaps: [] });
      }
      Object.assign(row, { status: 'completed', checkedInAt: NOW });
      const raw = postgresRows(sql, [{ id: row.id, table_id: row.tableId }]);
      return Promise.resolve({ raw, affected: raw.length, generatedMaps: [] });
    } as never,
  );

  const sameRestaurantAndCode =
    (where: { restaurantId?: string; code?: string; id?: string }) =>
    (row: Reservation) =>
      (where.id === undefined || row.id === where.id) &&
      (where.restaurantId === undefined ||
        row.restaurantId === where.restaurantId) &&
      (where.code === undefined || row.code === where.code);

  const reservationsRepo = {
    findOne: vi.fn(
      ({
        where,
      }: {
        where: { restaurantId: string; code: string };
        order: Record<string, string>;
      }) => {
        log.push('read');
        // Como Postgres con el ORDER BY de la consulta: la más reciente primero.
        const found = stored
          .filter(sameRestaurantAndCode(where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return Promise.resolve(found ?? null);
      },
    ),
    findOneOrFail: vi.fn(({ where }: { where: { id: string } }) => {
      log.push('reread');
      const found = stored.find(sameRestaurantAndCode(where));
      return found
        ? Promise.resolve(found)
        : Promise.reject(new Error('no existe'));
    }),
  };
  const tablesRepo = {
    update: vi.fn((criteria: Record<string, unknown>) => {
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
  const checkInsRepo = {
    insert: vi.fn(() => {
      log.push('insert-check-in');
      return options.checkInInsertFails
        ? Promise.reject(new Error('insert roto'))
        : Promise.resolve({});
    }),
  };
  const manager = {
    createQueryBuilder: () => metadataDataSource.createQueryBuilder(),
    getRepository: vi.fn((target: unknown) =>
      target === CheckIn ? checkInsRepo : tablesRepo,
    ),
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
      stored
        .filter((r) => r.id === id && r.status === 'active')
        .filter((r) => r.expiresAt <= NOW)
        .forEach((r) => Object.assign(r, { status: 'expired' }));
      return Promise.resolve(0);
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
  const labels = {
    read: vi.fn(() => {
      log.push('labels');
      return Promise.resolve(() => ({
        tableIdentifier: '04',
        dinerName: options.dinerName === undefined ? 'Ana' : options.dinerName,
      }));
    }),
  };
  const service = new CheckInService(
    dataSource as unknown as DataSource,
    expiration as unknown as ReservationExpirationService,
    statusLog as unknown as TableStatusLog,
    labels as unknown as ReservationLabelsReader,
    { now: () => NOW } as Clock,
  );
  return {
    service,
    stored,
    log,
    executed,
    manager,
    dataSource,
    reservationsRepo,
    tablesRepo,
    checkInsRepo,
    expiration,
    statusLog,
  };
}

const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

describe('CheckInService · check-in válido', () => {
  it('reserva, mesa, bitácora y check_ins cambian en la misma transacción, con las lecturas antes', async () => {
    const t = setup();

    const response = await t.service.checkIn(admin, CODE);

    expect(t.log).toEqual([
      'read',
      'labels',
      'begin',
      'update-reservation',
      'update-table',
      'log',
      'insert-check-in',
      'commit',
    ]);
    expect(response).toEqual({
      reservationId: RESERVATION_ID,
      tableIdentifier: '04',
      partySize: 2,
      dinerName: 'Ana',
      checkedInAt: NOW.toISOString(),
    });
  });

  it('dinerName puede ser null: la web muestra "Comensal"', async () => {
    const t = setup({ dinerName: null });

    const response = await t.service.checkIn(admin, CODE);

    expect(response.dinerName).toBeNull();
  });

  it('la mesa pasa a occupied solo si sigue reserved (la condición va en el UPDATE)', async () => {
    const t = setup();

    await t.service.checkIn(admin, CODE);

    expect(t.tablesRepo.update).toHaveBeenCalledWith(
      { id: TABLE_ID, status: 'reserved' },
      { status: 'occupied' },
    );
  });

  it('la bitácora lleva source reservation, el admin como usuario y reserved → occupied, con el manager de la transacción', async () => {
    const t = setup();

    await t.service.checkIn(admin, CODE);

    expect(t.statusLog.record).toHaveBeenCalledWith(
      {
        tableId: TABLE_ID,
        previousStatus: 'reserved',
        newStatus: 'occupied',
        userId: ADMIN_ID,
        source: 'reservation',
        changedAt: NOW,
      },
      t.manager,
    );
  });

  it('check_ins se inserta con el mismo instante de checked_in_at', async () => {
    const t = setup();

    await t.service.checkIn(admin, CODE);

    expect(t.checkInsRepo.insert).toHaveBeenCalledTimes(1);
    expect(t.checkInsRepo.insert).toHaveBeenCalledWith({
      reservationId: RESERVATION_ID,
      restaurantId: RESTAURANT_ID,
      checkedInAt: NOW,
    });
    expect(t.executed[0].params[1]).toBe(NOW);
  });

  it('el UPDATE lleva la condición completa, la hora del Clock y el RETURNING como texto (SQL real de TypeORM)', async () => {
    const t = setup();

    await t.service.checkIn(admin, CODE);

    const [{ sql, params }] = t.executed;
    expect(sql).toMatch(/^UPDATE "reservations" SET /);
    expect(sql).toContain('SET "status" = $1, "checked_in_at" = $2');
    expect(sql).toContain(
      `WHERE "id" = $3 AND "restaurant_id" = $4 AND "status" = 'active' AND "expires_at" > $5`,
    );
    expect(sql).toMatch(/RETURNING "id", "table_id"$/);
    expect(params).toEqual([
      'completed',
      NOW,
      RESERVATION_ID,
      RESTAURANT_ID,
      NOW,
    ]);
  });

  it('no emite RESTAURANT_AVAILABILITY_AFFECTED: el servicio ni siquiera recibe el emisor (reserved → occupied no cambia las mesas libres)', () => {
    // Si alguien agrega el evento tendrá que inyectar EventEmitter2: esto falla y
    // obliga a revisar la excepción anotada en CLAUDE.md §11.
    const dependencies = Reflect.getMetadata(
      'design:paramtypes',
      CheckInService,
    ) as { name: string }[];
    expect(dependencies.map((d) => d.name)).not.toContain('EventEmitter2');
  });

  it('una mesa cambiada a mano no se pisa: la reserva se cumple y hay check_ins, sin bitácora', async () => {
    const t = setup({ tableStillReserved: false });

    const response = await t.service.checkIn(admin, CODE);

    expect(response.reservationId).toBe(RESERVATION_ID);
    expect(t.statusLog.record).not.toHaveBeenCalled();
    expect(t.checkInsRepo.insert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['la bitácora', { logFails: true }, 'log roto'],
    ['check_ins', { checkInInsertFails: true }, 'insert roto'],
  ])('si falla %s, todo se revierte', async (_what, options, message) => {
    const t = setup(options);

    await expect(t.service.checkIn(admin, CODE)).rejects.toThrow(message);

    expect(t.log).toContain('rollback');
    expect(t.log).not.toContain('commit');
  });
});

describe('CheckInService · normalización y búsqueda', () => {
  it.each(['k7m4qx', '  K7M4QX ', 'k7m 4qx', 'k 7 m 4 q x'])(
    'acepta %j: busca con el código normalizado',
    async (raw) => {
      const t = setup();

      await t.service.checkIn(admin, raw);

      expect(t.reservationsRepo.findOne).toHaveBeenCalledWith({
        where: { restaurantId: RESTAURANT_ID, code: CODE },
        order: { createdAt: 'DESC', id: 'DESC' },
      });
    },
  );

  it.each([
    '',
    '   ',
    'K7M4Q',
    'K7M4QXX',
    'K7M0QX',
    'K7MOQX',
    'K7MIQX',
    'K7MLQX',
  ])('el formato inválido %j es el 404, sin consultar la base', async (raw) => {
    const t = setup();

    const error = await errorOf(t.service.checkIn(admin, raw));

    expect(error).toMatchObject({
      status: 404,
      response: {
        errorCode: 'RESERVATION_CODE_NOT_FOUND',
        message: RESERVATION_CODE_NOT_FOUND_MESSAGE,
      },
    });
    expect(t.reservationsRepo.findOne).not.toHaveBeenCalled();
  });

  it('un código de otro restaurante da un 404 idéntico al de uno inexistente, sin vencer ni tocar nada', async () => {
    const t = setup({
      stored: [
        reservation({
          restaurantId: OTHER_RESTAURANT_ID,
          expiresAt: new Date('2026-11-05T16:00:00Z'),
        }),
      ],
    });

    const ofOther = await errorOf(t.service.checkIn(admin, CODE));
    const unknown = await errorOf(t.service.checkIn(admin, '222222'));

    expect(ofOther).toMatchObject({
      status: 404,
      response: { errorCode: 'RESERVATION_CODE_NOT_FOUND' },
    });
    expect(unknown).toEqual(ofOther);
    expect(t.expiration.expireIfDue).not.toHaveBeenCalled();
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
    expect(t.stored[0].status).toBe('active');
  });

  it('código reutilizado: con una completed vieja y una active nueva, se usa la más reciente', async () => {
    const t = setup({
      stored: [
        reservation({
          id: OLD_RESERVATION_ID,
          status: 'completed',
          createdAt: new Date('2026-11-01T16:50:00Z'),
          checkedInAt: new Date('2026-11-01T17:00:00Z'),
        }),
        reservation(),
      ],
    });

    const response = await t.service.checkIn(admin, CODE);

    expect(response.reservationId).toBe(RESERVATION_ID);
    expect(t.stored[0].status).toBe('completed');
    expect(t.stored[1].status).toBe('completed');
  });

  it('un restaurant_admin sin restaurante recibe RESTAURANT_REQUIRED, antes de mirar el código', async () => {
    const t = setup();

    const error = await errorOf(
      t.service.checkIn({ ...admin, restaurantId: null }, 'no importa'),
    );

    expect(error).toMatchObject({
      status: 403,
      response: { errorCode: 'RESTAURANT_REQUIRED' },
    });
    expect(t.reservationsRepo.findOne).not.toHaveBeenCalled();
  });
});

describe('CheckInService · reservas que ya no se pueden cumplir', () => {
  it('expired: 409 con la hora de expires_at (no la de expired_at) en Bogotá', async () => {
    const t = setup({
      stored: [
        reservation({
          status: 'expired',
          // 12:41 en Bogotá; se barrió media hora después.
          expiresAt: new Date('2026-11-05T17:41:00Z'),
          expiredAt: new Date('2026-11-05T18:11:00Z'),
        }),
      ],
    });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      status: 409,
      response: {
        errorCode: 'RESERVATION_EXPIRED',
        message: 'Esta reserva se venció a las 12:41. La mesa ya se liberó.',
      },
    });
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('expired cerca de medianoche UTC: 04:41Z son las 23:41 de Bogotá', async () => {
    const t = setup({
      stored: [
        reservation({
          status: 'expired',
          expiresAt: new Date('2026-11-06T04:41:00Z'),
        }),
      ],
    });

    const error = (await errorOf(t.service.checkIn(admin, CODE))) as Error;

    expect(error.message).toBe(
      'Esta reserva se venció a las 23:41. La mesa ya se liberó.',
    );
  });

  it('completed: 409 con la hora de checked_in_at en Bogotá', async () => {
    const t = setup({
      stored: [
        reservation({
          status: 'completed',
          checkedInAt: new Date('2026-11-05T17:35:00Z'),
        }),
      ],
    });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      status: 409,
      response: {
        errorCode: 'RESERVATION_ALREADY_USED',
        message: 'Este código ya se usó a las 12:35.',
      },
    });
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('cancelled: 409 con el mensaje de §12.6', async () => {
    const t = setup({ stored: [reservation({ status: 'cancelled' })] });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      status: 409,
      response: {
        errorCode: 'RESERVATION_CANCELLED',
        message: 'El comensal canceló esta reserva.',
      },
    });
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('activa vencida sin barrer: se vence fuera de toda transacción y responde RESERVATION_EXPIRED', async () => {
    const t = setup({
      stored: [reservation({ expiresAt: new Date('2026-11-05T16:59:00Z') })],
    });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      status: 409,
      response: {
        errorCode: 'RESERVATION_EXPIRED',
        message: 'Esta reserva se venció a las 11:59. La mesa ya se liberó.',
      },
    });
    expect(t.expiration.expireIfDue).toHaveBeenCalledWith(RESERVATION_ID);
    expect(t.dataSource.transaction).not.toHaveBeenCalled();
    expect(t.checkInsRepo.insert).not.toHaveBeenCalled();
  });

  it('otro check-in se adelantó: el UPDATE no devuelve fila y responde RESERVATION_ALREADY_USED, sin mesa, bitácora ni check_ins', async () => {
    const t = setup({
      updateHits: false,
      afterLostUpdate: (row) =>
        Object.assign(row, {
          status: 'completed',
          checkedInAt: new Date('2026-11-05T16:59:30Z'),
        }),
    });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      response: {
        errorCode: 'RESERVATION_ALREADY_USED',
        message: 'Este código ya se usó a las 11:59.',
      },
    });
    expect(t.tablesRepo.update).not.toHaveBeenCalled();
    expect(t.statusLog.record).not.toHaveBeenCalled();
    expect(t.checkInsRepo.insert).not.toHaveBeenCalled();
    expect(t.log.indexOf('commit')).toBeLessThan(t.log.indexOf('expireIfDue'));
  });

  it('el comensal canceló entre medias: responde RESERVATION_CANCELLED', async () => {
    const t = setup({
      updateHits: false,
      afterLostUpdate: (row) => Object.assign(row, { status: 'cancelled' }),
    });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      response: { errorCode: 'RESERVATION_CANCELLED' },
    });
  });

  it('venció entre la lectura y el UPDATE: se vence DESPUÉS de cerrar la transacción y responde RESERVATION_EXPIRED', async () => {
    const t = setup({
      updateHits: false,
      afterLostUpdate: (row) =>
        Object.assign(row, { expiresAt: new Date('2026-11-05T16:59:59Z') }),
    });

    const error = await errorOf(t.service.checkIn(admin, CODE));

    expect(error).toMatchObject({
      response: { errorCode: 'RESERVATION_EXPIRED' },
    });
    expect(t.log.indexOf('commit')).toBeLessThan(t.log.indexOf('expireIfDue'));
    expect(t.log.indexOf('expireIfDue')).toBeLessThan(t.log.indexOf('reread'));
  });

  it('un estado imposible (sigue activa y vigente tras un UPDATE sin fila) no se disfraza: va al filtro global', async () => {
    const t = setup({ updateHits: false });

    await expect(t.service.checkIn(admin, CODE)).rejects.toThrow(
      'no se pudo cumplir',
    );
  });
});

describe('TypeORM: por qué el RETURNING va como texto', () => {
  it('returning([...]) con nombres de columna descartaría table_id', () => {
    const [sql] = metadataDataSource
      .createQueryBuilder()
      .update(Reservation)
      .set({ status: 'completed' })
      .where('"id" = :id', { id: RESERVATION_ID })
      .returning(['id', 'table_id'])
      .getQueryAndParameters();

    expect(sql).toMatch(/RETURNING "id"$/);
  });
});
