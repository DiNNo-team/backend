import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { DataSource } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type TableStatusLog,
} from '../../restaurant-operations/index.js';
import type {
  AvailabilityService,
  Clock,
  TableSnapshot,
} from '../../search-availability/index.js';
import {
  CODE_ATTEMPTS,
  CreateReservationService,
  UQ_ACTIVE_CODE,
  UQ_ACTIVE_DINER,
  UQ_ACTIVE_TABLE,
} from './create-reservation.service.js';
import type { ReservationLabelsReader } from '../check-ins/reservation-labels.reader.js';
import type { CodeGenerator } from './reservation-code.js';
import type { ReservationExpirationService } from './reservation-expiration.service.js';
import { Reservation } from './reservation.entity.js';

const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

const user: CurrentUserData = {
  userId: DINER_ID,
  restaurantId: null,
  role: 'diner' as CurrentUserData['role'],
  restaurantApproval: null,
};

interface TableRow extends TableSnapshot {
  id: string;
  restaurantId: string;
  identifier: string;
}

const row = (
  id: string,
  identifier: string,
  capacity: number,
  overrides: Partial<TableRow> = {},
): TableRow => ({
  id,
  restaurantId: RESTAURANT_ID,
  identifier,
  capacity,
  status: 'available',
  isActive: true,
  ...overrides,
});

const uniqueViolation = (constraint: string) =>
  Object.assign(new Error('duplicate key'), { code: '23505', constraint });

interface Options {
  restaurant?: Record<string, unknown> | null;
  isOpenNow?: boolean;
  hasActiveReservation?: boolean;
  // Una reserva activa YA vencida que el proceso periódico no barrió: existe
  // hasta que se llama al servicio de vencimiento, que la vence.
  staleActiveReservation?: boolean;
  // Lo que devuelve la lectura de candidatas, sin bloquear.
  candidates?: TableRow[];
  // Lo que devuelve el bloqueo de cada mesa por id; null = bloqueada por otra
  // transacción (SKIP LOCKED no la devuelve). Sin entrada: la fila de candidates.
  locked?: Record<string, TableRow | null>;
  codes?: string[];
  ttlMinutes?: number;
  // Errores con los que falla cada intento, después de correr su trabajo
  // (undefined = el intento termina bien).
  transactionErrors?: unknown[];
  logFails?: boolean;
  labelsFail?: boolean;
}

function setup(options: Options = {}) {
  const candidates = options.candidates ?? [row('t-4', '04', 4)];
  const log: string[] = [];
  let attempt = 0;
  let staleExpired = false;
  const codes = [...(options.codes ?? ['K7M4QX'])];

  const tablesRepo = {
    find: vi.fn(() => Promise.resolve(candidates)),
    findOne: vi.fn(({ where }: { where: { id: string } }) => {
      log.push(`lock:${where.id}`);
      const forced = options.locked?.[where.id];
      return Promise.resolve(
        forced !== undefined
          ? forced
          : (candidates.find((table) => table.id === where.id) ?? null),
      );
    }),
    update: vi.fn(() => Promise.resolve({})),
  };
  const reservationsRepo = {
    exists: vi.fn(() =>
      Promise.resolve(
        (options.hasActiveReservation ?? false) ||
          (options.staleActiveReservation === true && !staleExpired),
      ),
    ),
    save: vi.fn((data: Record<string, unknown>) =>
      Promise.resolve({
        ...data,
        id: 'res-1',
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ),
  };
  const manager = {
    getRepository: vi.fn((target: unknown) =>
      target === Reservation ? reservationsRepo : tablesRepo,
    ),
  };
  const restaurantsRepo = {
    findOne: vi.fn(() =>
      Promise.resolve(
        options.restaurant === undefined
          ? {
              id: RESTAURANT_ID,
              name: 'Casa 72',
              address: 'Calle 72',
              latitude: '4.655671',
              longitude: '-74.057006',
            }
          : options.restaurant,
      ),
    ),
  };
  const dataSource = {
    getRepository: vi.fn(() => restaurantsRepo),
    transaction: vi.fn(async (work: (m: unknown) => Promise<unknown>) => {
      const error = options.transactionErrors?.[attempt];
      attempt += 1;
      try {
        const result = await work(manager);
        // Un error de la lista simula la falla en el insert o en el commit,
        // después de que el trabajo corrió.
        if (error !== undefined) {
          throw error;
        }
        log.push('commit');
        return result;
      } catch (failure) {
        log.push('rollback');
        throw failure;
      }
    }),
  };
  const availability = {
    getForRestaurant: vi.fn(() =>
      Promise.resolve({
        isOpenNow: options.isOpenNow ?? true,
        availability: 'available',
        isSearchable: true,
      }),
    ),
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
    emit: vi.fn((name: string) => {
      log.push(`emit:${name}`);
      return true;
    }),
  };
  const labels = {
    read: vi.fn(() => {
      log.push('labels');
      return options.labelsFail
        ? Promise.reject(new Error('lectura rota'))
        : Promise.resolve(() => ({
            tableIdentifier: '04',
            dinerName: 'Ana',
          }));
    }),
  };
  const expiration = {
    expireDueForDiner: vi.fn(() => {
      log.push('expire');
      staleExpired = true;
      return Promise.resolve(options.staleActiveReservation ? 1 : 0);
    }),
    expireDueForRestaurant: vi.fn(() => {
      log.push('expire-restaurant');
      return Promise.resolve(0);
    }),
  };
  const generator = { generate: vi.fn(() => codes.shift() ?? 'ZZZZZZ') };
  const service = new CreateReservationService(
    dataSource as unknown as DataSource,
    availability as unknown as AvailabilityService,
    statusLog as unknown as TableStatusLog,
    events as unknown as EventEmitter2,
    { now: () => NOW } as Clock,
    generator as unknown as CodeGenerator,
    { ttlMinutes: options.ttlMinutes ?? 15 },
    expiration as unknown as ReservationExpirationService,
    labels as unknown as ReservationLabelsReader,
  );
  return {
    service,
    log,
    manager,
    tablesRepo,
    reservationsRepo,
    dataSource,
    availability,
    statusLog,
    events,
    generator,
    expiration,
  };
}

const create = (service: CreateReservationService, partySize = 2) =>
  service.create(user, { restaurantId: RESTAURANT_ID, partySize });

const errorCodeOf = (error: unknown) =>
  (error as { response?: { errorCode?: string } }).response?.errorCode;

describe('CreateReservationService', () => {
  describe('éxito', () => {
    it('crea la reserva, pasa la mesa a reserved y escribe la bitácora con el mismo manager', async () => {
      const t = setup();

      const response = await create(t.service);

      expect(t.reservationsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'K7M4QX',
          status: 'active',
          partySize: 2,
          dinerId: DINER_ID,
          restaurantId: RESTAURANT_ID,
          tableId: 't-4',
          noShow: false,
          cancelledAt: null,
          expiredAt: null,
          checkedInAt: null,
        }),
      );
      expect(t.tablesRepo.update).toHaveBeenCalledWith(
        { id: 't-4' },
        { status: 'reserved' },
      );
      expect(t.statusLog.record).toHaveBeenCalledWith(
        {
          tableId: 't-4',
          previousStatus: 'available',
          newStatus: 'reserved',
          userId: DINER_ID,
          source: 'reservation',
          changedAt: NOW,
        },
        t.manager,
      );
      expect(response).toMatchObject({
        id: 'res-1',
        code: 'K7M4QX',
        status: 'active',
        partySize: 2,
        serverTime: NOW.toISOString(),
        restaurant: {
          id: RESTAURANT_ID,
          name: 'Casa 72',
          address: 'Calle 72',
          latitude: 4.655671,
          longitude: -74.057006,
        },
        table: { identifier: '04', capacity: 4 },
      });
    });

    it('emite el evento de disponibilidad solo después del commit, con el id del restaurante', async () => {
      const t = setup();

      await create(t.service);

      expect(t.log).toEqual([
        'expire',
        'expire-restaurant',
        'lock:t-4',
        'log',
        'commit',
        'labels',
        'emit:reservation.created',
        'emit:table.status-changed',
        `emit:${RESTAURANT_AVAILABILITY_AFFECTED}`,
      ]);
      expect(t.events.emit).toHaveBeenCalledWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        { restaurantId: RESTAURANT_ID },
      );
    });

    it('publica reservation.created (sin código) y table.status_changed, exactamente una vez cada uno', async () => {
      const t = setup();

      await create(t.service);

      expect(t.events.emit).toHaveBeenCalledTimes(3);
      expect(t.events.emit).toHaveBeenCalledWith('reservation.created', {
        restaurantId: RESTAURANT_ID,
        reservation: {
          id: 'res-1',
          status: 'active',
          partySize: 2,
          dinerName: 'Ana',
          tableId: 't-4',
          tableIdentifier: '04',
          createdAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
          serverTime: NOW.toISOString(),
        },
      });
      expect(t.events.emit).toHaveBeenCalledWith('table.status-changed', {
        restaurantId: RESTAURANT_ID,
        tableId: 't-4',
        previousStatus: 'available',
        status: 'reserved',
        source: 'reservation',
      });
    });

    it('si fallan las etiquetas después del commit, el comensal recibe su reserva y solo se pierde reservation.created', async () => {
      const t = setup({ labelsFail: true });
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      const response = await create(t.service);

      expect(response.status).toBe('active');
      expect(warn).toHaveBeenCalledWith(
        'No se pudo publicar reservation.created de la reserva res-1: Error',
      );
      expect(t.log.filter((entry) => entry.startsWith('emit:'))).toEqual([
        'emit:table.status-changed',
        `emit:${RESTAURANT_AVAILABILITY_AFFECTED}`,
      ]);
      warn.mockRestore();
    });

    it.each([3, 15])('vence en %i minutos con el reloj fijo', async (ttl) => {
      const t = setup({ ttlMinutes: ttl });

      const response = await create(t.service);

      expect(response.expiresAt).toBe(
        new Date(NOW.getTime() + ttl * 60_000).toISOString(),
      );
    });
  });

  describe('el restaurante', () => {
    it.each([
      ['no existe', null],
      [
        'no tiene ubicación',
        {
          id: RESTAURANT_ID,
          name: 'X',
          address: null,
          latitude: null,
          longitude: null,
        },
      ],
    ])(
      '404 RESTAURANT_NOT_FOUND si %s, sin abrir transacción',
      async (_label, restaurant) => {
        const t = setup({ restaurant });

        const error = await create(t.service).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(NotFoundException);
        expect(errorCodeOf(error)).toBe('RESTAURANT_NOT_FOUND');
        expect(t.dataSource.transaction).not.toHaveBeenCalled();
        expect(t.events.emit).not.toHaveBeenCalled();
      },
    );

    it('409 RESTAURANT_CLOSED si no está abierto ahora (reutiliza la regla de disponibilidad)', async () => {
      const t = setup({ isOpenNow: false });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(errorCodeOf(error)).toBe('RESTAURANT_CLOSED');
      expect((error as Error).message).toBe(
        'Este restaurante acaba de cerrar.',
      );
      expect(t.availability.getForRestaurant).toHaveBeenCalledWith(
        RESTAURANT_ID,
      );
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('un restaurante cerrado con coordenadas es 409, no 404', async () => {
      const t = setup({ isOpenNow: false });

      await expect(create(t.service)).rejects.not.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('el comensal', () => {
    it('409 ACTIVE_RESERVATION_EXISTS si ya tiene una reserva activa, sin tocar mesas', async () => {
      const t = setup({ hasActiveReservation: true });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(errorCodeOf(error)).toBe('ACTIVE_RESERVATION_EXISTS');
      expect((error as Error).message).toBe('Ya tienes una reserva activa');
      expect(t.reservationsRepo.exists).toHaveBeenCalledWith({
        where: { dinerId: DINER_ID, status: 'active' },
      });
      expect(t.tablesRepo.find).not.toHaveBeenCalled();
      expect(t.events.emit).not.toHaveBeenCalled();
    });

    it('vence la reserva del comensal antes de comprobar la reserva activa, y antes de la transacción', async () => {
      const t = setup();

      await create(t.service);

      expect(t.expiration.expireDueForDiner).toHaveBeenCalledWith(DINER_ID);
      expect(t.log.indexOf('expire')).toBe(0);
      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('con una reserva vencida que el proceso aún no barrió, ahora crea una nueva (sin ACTIVE_RESERVATION_EXISTS)', async () => {
      const t = setup({ staleActiveReservation: true });

      const response = await create(t.service);

      expect(response.status).toBe('active');
      expect(t.reservationsRepo.save).toHaveBeenCalledTimes(1);
    });

    it('una reserva activa vigente sigue dando ACTIVE_RESERVATION_EXISTS: el vencimiento no la toca', async () => {
      const t = setup({ hasActiveReservation: true });

      await expect(create(t.service)).rejects.toMatchObject({
        response: { errorCode: 'ACTIVE_RESERVATION_EXISTS' },
      });
      expect(t.expiration.expireDueForDiner).toHaveBeenCalledTimes(1);
    });

    it('si el restaurante está cerrado no se intenta vencer nada', async () => {
      const t = setup({ isOpenNow: false });

      await create(t.service).catch(() => undefined);

      expect(t.expiration.expireDueForDiner).not.toHaveBeenCalled();
      expect(t.expiration.expireDueForRestaurant).not.toHaveBeenCalled();
    });

    it('vence también las del restaurante, después de las del comensal y antes de abrir la transacción', async () => {
      const t = setup();
      let transactionsWhenExpiring = -1;
      t.expiration.expireDueForRestaurant.mockImplementationOnce(() => {
        transactionsWhenExpiring = t.dataSource.transaction.mock.calls.length;
        t.log.push('expire-restaurant');
        return Promise.resolve(0);
      });

      await create(t.service);

      expect(t.expiration.expireDueForRestaurant).toHaveBeenCalledWith(
        RESTAURANT_ID,
      );
      expect(t.log.slice(0, 2)).toEqual(['expire', 'expire-restaurant']);
      expect(transactionsWhenExpiring).toBe(0);
    });

    it('restaurante lleno solo por reservas vencidas ajenas: al vencerlas, el comensal recibe mesa', async () => {
      const freed = row('t-9', '09', 4);
      const t = setup({ candidates: [] });
      t.expiration.expireDueForRestaurant.mockImplementationOnce(() => {
        t.tablesRepo.find.mockResolvedValueOnce([freed]);
        t.tablesRepo.findOne.mockResolvedValueOnce(freed);
        return Promise.resolve(1);
      });

      const response = await create(t.service);

      expect(response.table.identifier).toBe('09');
      expect(t.reservationsRepo.save).toHaveBeenCalledTimes(1);
    });

    it('sin mesas tampoco después de vencer: sigue siendo NO_TABLE_AVAILABLE', async () => {
      const t = setup({ candidates: [] });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(errorCodeOf(error)).toBe('NO_TABLE_AVAILABLE');
      expect(t.expiration.expireDueForRestaurant).toHaveBeenCalledTimes(1);
    });

    it('la reserva activa se revisa antes que las mesas (orden c antes que d)', async () => {
      const t = setup({ hasActiveReservation: true, candidates: [] });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(errorCodeOf(error)).toBe('ACTIVE_RESERVATION_EXISTS');
    });
  });

  describe('la mesa', () => {
    it('409 NO_TABLE_AVAILABLE si no hay candidatas', async () => {
      const t = setup({ candidates: [] });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(errorCodeOf(error)).toBe('NO_TABLE_AVAILABLE');
      expect((error as Error).message).toBe(
        'Alguien acaba de tomar la última mesa. Prueba con otro restaurante.',
      );
      expect(t.reservationsRepo.save).not.toHaveBeenCalled();
      expect(t.events.emit).not.toHaveBeenCalled();
    });

    it('409 NO_TABLE_AVAILABLE si ninguna mesa alcanza para el grupo', async () => {
      const t = setup({ candidates: [row('t-2', '02', 2)] });

      await expect(create(t.service, 3)).rejects.toMatchObject({
        response: { errorCode: 'NO_TABLE_AVAILABLE' },
      });
      expect(t.tablesRepo.findOne).not.toHaveBeenCalled();
    });

    it('lee solo las mesas activas y Disponibles del restaurante', async () => {
      const t = setup();

      await create(t.service);

      expect(t.tablesRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            restaurantId: RESTAURANT_ID,
            isActive: true,
            status: 'available',
          },
        }),
      );
    });

    it('recorre las candidatas en el orden de la regla: la más pequeña que alcanza primero', async () => {
      const t = setup({
        candidates: [
          row('t-8', '08', 8),
          row('t-4', '04', 4),
          row('t-2', '02', 2),
        ],
        locked: { 't-4': null, 't-8': null },
      });

      await create(t.service, 3).catch(() => undefined);

      // La de 2 no alcanza: se intenta la de 4 y luego la de 8, en ese orden.
      expect(t.log.filter((entry) => entry.startsWith('lock:'))).toEqual([
        'lock:t-4',
        'lock:t-8',
      ]);
    });

    it('con empate de capacidad recorre por identificador numérico: "2" antes que "10"', async () => {
      const t = setup({
        candidates: [row('t-10', '10', 4), row('t-2', '2', 4)],
        locked: { 't-2': null, 't-10': null },
      });

      await create(t.service, 4).catch(() => undefined);

      expect(t.log.filter((entry) => entry.startsWith('lock:'))).toEqual([
        'lock:t-2',
        'lock:t-10',
      ]);
    });

    it('si una mesa está bloqueada por otra transacción pasa a la siguiente y responde con ella', async () => {
      const t = setup({
        candidates: [row('t-2', '02', 2), row('t-4', '04', 4)],
        locked: { 't-2': null },
      });

      const response = await create(t.service);

      expect(response.table).toEqual({ identifier: '04', capacity: 4 });
      expect(t.tablesRepo.update).toHaveBeenCalledWith(
        { id: 't-4' },
        { status: 'reserved' },
      );
    });

    it('responde NO_TABLE_AVAILABLE solo cuando se agotan todas las candidatas', async () => {
      const t = setup({
        candidates: [row('t-2', '02', 2), row('t-4', '04', 4)],
        locked: { 't-2': null, 't-4': null },
      });

      await expect(create(t.service)).rejects.toMatchObject({
        response: { errorCode: 'NO_TABLE_AVAILABLE' },
      });
      expect(t.tablesRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('bloquea con FOR UPDATE SKIP LOCKED, por id y del restaurante', async () => {
      const t = setup();

      await create(t.service);

      expect(t.tablesRepo.findOne).toHaveBeenCalledWith({
        where: { id: 't-4', restaurantId: RESTAURANT_ID },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
    });

    it.each([
      ['pasó a reserved', { status: 'reserved' as const }],
      ['pasó a occupied', { status: 'occupied' as const }],
      ['se desactivó', { isActive: false }],
      ['bajó de capacidad', { capacity: 1 }],
    ])(
      'revalida bajo el bloqueo: si la mesa %s después de leerla, pasa a la siguiente',
      async (_label, change) => {
        const stale = row('t-2', '02', 2);
        const t = setup({
          candidates: [stale, row('t-4', '04', 4)],
          locked: { 't-2': { ...stale, ...change } },
        });

        const response = await create(t.service);

        expect(response.table.identifier).toBe('04');
      },
    );

    it('revalida que la mesa sea del restaurante, aunque la consulta ya filtre por él', async () => {
      const t = setup({
        candidates: [row('t-2', '02', 2)],
        locked: { 't-2': row('t-2', '02', 2, { restaurantId: 'otro' }) },
      });

      await expect(create(t.service)).rejects.toMatchObject({
        response: { errorCode: 'NO_TABLE_AVAILABLE' },
      });
    });
  });

  describe('atomicidad', () => {
    it('si la bitácora falla, el error se propaga (rollback) y no se emite nada', async () => {
      const t = setup({ logFails: true });

      await expect(create(t.service)).rejects.toThrow('log roto');

      expect(t.log).toContain('rollback');
      expect(t.log).not.toContain('commit');
      expect(t.events.emit).not.toHaveBeenCalled();
    });
  });

  describe('violaciones de unicidad de la base', () => {
    it(`${UQ_ACTIVE_DINER} → 409 ACTIVE_RESERVATION_EXISTS`, async () => {
      const t = setup({
        transactionErrors: [uniqueViolation(UQ_ACTIVE_DINER)],
      });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(errorCodeOf(error)).toBe('ACTIVE_RESERVATION_EXISTS');
      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(t.events.emit).not.toHaveBeenCalled();
    });

    it(`${UQ_ACTIVE_TABLE} → 409 NO_TABLE_AVAILABLE`, async () => {
      const t = setup({
        transactionErrors: [uniqueViolation(UQ_ACTIVE_TABLE)],
      });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(errorCodeOf(error)).toBe('NO_TABLE_AVAILABLE');
      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('la violación puede venir envuelta como la entrega TypeORM (driverError)', async () => {
      const wrapped = Object.assign(new Error('query failed'), {
        driverError: { code: '23505', constraint: UQ_ACTIVE_DINER },
      });
      const t = setup({ transactionErrors: [wrapped] });

      await expect(create(t.service)).rejects.toMatchObject({
        response: { errorCode: 'ACTIVE_RESERVATION_EXISTS' },
      });
    });

    it('otra violación de unicidad o cualquier otro error pasa sin traducir', async () => {
      const other = uniqueViolation('UQ_otra_cosa');
      const t = setup({ transactionErrors: [other] });

      await expect(create(t.service)).rejects.toBe(other);
    });
  });

  describe('código repetido', () => {
    it('reintenta la transacción completa con otro código y publica solo lo del intento que confirmó', async () => {
      const t = setup({
        codes: ['AAAAAA', 'BBBBBB'],
        transactionErrors: [uniqueViolation(UQ_ACTIVE_CODE)],
      });

      const response = await create(t.service);

      expect(t.dataSource.transaction).toHaveBeenCalledTimes(2);
      expect(t.generator.generate).toHaveBeenCalledTimes(2);
      expect(response.code).toBe('BBBBBB');
      // El primer intento también escribió la bitácora, pero se revirtió: un solo
      // table.status_changed, reservation.created y disponibilidad.
      expect(t.statusLog.record).toHaveBeenCalledTimes(2);
      expect(t.events.emit).toHaveBeenCalledTimes(3);
      expect(t.log.filter((entry) => entry === 'rollback')).toHaveLength(1);
    });

    it('usa un código nuevo en cada intento', async () => {
      const t = setup({
        codes: ['AAAAAA', 'BBBBBB', 'CCCCCC'],
        transactionErrors: [
          uniqueViolation(UQ_ACTIVE_CODE),
          uniqueViolation(UQ_ACTIVE_CODE),
        ],
      });

      const response = await create(t.service);

      expect(t.dataSource.transaction).toHaveBeenCalledTimes(3);
      expect(response.code).toBe('CCCCCC');
    });

    it(`tras ${CODE_ATTEMPTS} intentos responde un error normal (500 del filtro global), sin emitir`, async () => {
      const t = setup({
        transactionErrors: Array.from({ length: CODE_ATTEMPTS }, () =>
          uniqueViolation(UQ_ACTIVE_CODE),
        ),
      });

      const error = await create(t.service).catch((e: unknown) => e);

      expect(t.dataSource.transaction).toHaveBeenCalledTimes(CODE_ATTEMPTS);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ConflictException);
      expect((error as Error).message).toContain(`${CODE_ATTEMPTS} intentos`);
      expect(t.events.emit).not.toHaveBeenCalled();
    });
  });
});
