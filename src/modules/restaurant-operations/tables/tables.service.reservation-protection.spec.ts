import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { EntityManager, Repository } from 'typeorm';
import { fakeTableReservations } from '../../../../test/support/table-reservations.js';
import { type CurrentUserData, UserRole } from '../../identity-access/index.js';
import type { Table } from './table.entity.js';
import {
  TABLE_HAS_ACTIVE_RESERVATION_CODE,
  TABLE_HAS_ACTIVE_RESERVATION_MESSAGE,
  TABLE_NOT_AVAILABLE_TO_DEACTIVATE_CODE,
  TABLE_NOT_AVAILABLE_TO_DEACTIVATE_MESSAGE,
} from './table-reservation-errors.js';
import type { TableStatusLog } from './table-status-log.js';
import {
  TABLE_ALREADY_INACTIVE_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  TablesService,
} from './tables.service.js';

// Protección de las mesas con reserva DiNNo activa (CLAUDE.md §12.2): una
// prueba por fila de la tabla y por rama del orden de validaciones.

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';

const owner: CurrentUserData = {
  userId: USER_ID,
  restaurantId: RESTAURANT_ID,
  role: UserRole.RESTAURANT_ADMIN,
};

const row = (overrides: Partial<Table> = {}): Table =>
  ({
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    identifier: '04',
    capacity: 4,
    status: 'available',
    isActive: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
    planX: null,
    planY: null,
    planShape: null,
    ...overrides,
  }) as Table;

interface Options {
  table?: Table | null;
  reservation?: { partySize: number } | null;
}

function setup(options: Options = {}) {
  const log: string[] = [];
  const table = options.table === undefined ? row() : options.table;

  const manager = {
    findOne: vi.fn(() => {
      log.push('lock-table');
      return Promise.resolve(table ? { ...table } : null);
    }),
    save: vi.fn((saved: Table) => {
      log.push('save');
      return Promise.resolve({ ...saved });
    }),
    update: vi.fn(() => {
      log.push('update');
      return Promise.resolve({ affected: 1 });
    }),
  };
  const repository = {
    find: vi.fn(() => Promise.resolve([])),
    manager: {
      transaction: vi.fn(
        async <T>(work: (m: EntityManager) => Promise<T>): Promise<T> => {
          log.push('begin');
          return work(manager as unknown as EntityManager);
        },
      ),
    },
  };
  const reservations = fakeTableReservations({
    expireDueForTable: vi.fn(() => {
      log.push('expire');
      return Promise.resolve();
    }),
    findActiveForTable: vi.fn(() => {
      log.push('find-reservation');
      return Promise.resolve(options.reservation ?? null);
    }),
  });
  const statusLog = {
    record: vi.fn(() => {
      log.push('log');
      return Promise.resolve();
    }),
  };
  const events = { emit: vi.fn() };
  const service = new TablesService(
    repository as unknown as Repository<Table>,
    statusLog as unknown as TableStatusLog,
    events as unknown as EventEmitter2,
    reservations,
  );
  return { service, log, manager, reservations, statusLog, events };
}

type Setup = ReturnType<typeof setup>;

const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

const hasActiveReservation = {
  status: 409,
  response: {
    errorCode: TABLE_HAS_ACTIVE_RESERVATION_CODE,
    message: TABLE_HAS_ACTIVE_RESERVATION_MESSAGE,
  },
};

describe('TablesService · cambiar estado (§12.2)', () => {
  it('mesa con reserva DiNNo activa → 409 TABLE_HAS_ACTIVE_RESERVATION y no cambia nada', async () => {
    const t = setup({
      table: row({ status: 'reserved' }),
      reservation: { partySize: 2 },
    });

    const error = await errorOf(
      t.service.updateStatus(owner, TABLE_ID, 'available'),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject(hasActiveReservation);
    expect(t.manager.save).not.toHaveBeenCalled();
    expect(t.statusLog.record).not.toHaveBeenCalled();
    expect(t.events.emit).not.toHaveBeenCalled();
  });

  it('el mensaje es exactamente el de §12.2', async () => {
    const t = setup({ reservation: { partySize: 2 } });

    const error = await errorOf(
      t.service.updateStatus(owner, TABLE_ID, 'occupied'),
    );

    expect((error as Error).message).toBe(
      'Esta mesa tiene una reserva de DiNNo en curso. Se libera sola cuando el comensal llegue, cancele o se venza la reserva.',
    );
  });

  it('"Deshacer" sin cambio (el mismo estado) con reserva activa también es 409, antes del atajo de sin cambios', async () => {
    const t = setup({
      table: row({ status: 'reserved' }),
      reservation: { partySize: 2 },
    });

    const error = await errorOf(
      t.service.updateStatus(owner, TABLE_ID, 'reserved'),
    );

    expect(error).toMatchObject(hasActiveReservation);
  });

  it.each(['reserved', 'occupied'] as const)(
    'mesa %s a mano, sin reserva DiNNo: se cambia como siempre',
    async (status) => {
      const t = setup({ table: row({ status }), reservation: null });

      const result = await t.service.updateStatus(owner, TABLE_ID, 'available');

      expect(result.status).toBe('available');
      expect(t.statusLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatus: status,
          newStatus: 'available',
          source: 'manual',
        }),
        t.manager,
      );
    },
  );

  it('mesa disponible sin reserva: se cambia como siempre', async () => {
    const t = setup();

    await expect(
      t.service.updateStatus(owner, TABLE_ID, 'occupied'),
    ).resolves.toMatchObject({ status: 'occupied' });
  });

  it('vence una reserva debida ANTES de abrir la transacción y la comprueba DESPUÉS de bloquear la mesa', async () => {
    const t = setup();

    await t.service.updateStatus(owner, TABLE_ID, 'occupied');

    expect(t.reservations.expireDueForTable).toHaveBeenCalledWith(TABLE_ID);
    expect(t.log.slice(0, 4)).toEqual([
      'expire',
      'begin',
      'lock-table',
      'find-reservation',
    ]);
  });

  it('reserva activa ya vencida sin barrer: se vence primero y la mesa se trata como sin reserva', async () => {
    // El vencimiento libera la mesa (queda available) y deja de haber reserva
    // activa: lo que se lee dentro de la transacción ya no la ve.
    const t = setup({ table: row({ status: 'available' }), reservation: null });

    const result = await t.service.updateStatus(owner, TABLE_ID, 'occupied');

    expect(result.status).toBe('occupied');
    expect(t.reservations.expireDueForTable).toHaveBeenCalledTimes(1);
  });

  it('el orden: 404 primero, sin consultar reservas dentro de la transacción', async () => {
    const t = setup({ table: null, reservation: { partySize: 2 } });

    const error = await errorOf(
      t.service.updateStatus(owner, TABLE_ID, 'available'),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe(TABLE_NOT_FOUND_MESSAGE);
    expect(t.reservations.findActiveForTable).not.toHaveBeenCalled();
  });

  it('una mesa inactiva sigue dando su 409 sin errorCode, antes que el de reserva', async () => {
    const t = setup({
      table: row({ isActive: false }),
      reservation: { partySize: 2 },
    });

    const error = await errorOf(
      t.service.updateStatus(owner, TABLE_ID, 'available'),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).not.toMatchObject({
      response: { errorCode: expect.anything() },
    });
    expect(t.reservations.findActiveForTable).not.toHaveBeenCalled();
  });
});

describe('TablesService · desactivar (§12.2)', () => {
  it('a. 404 como hoy', async () => {
    const t = setup({ table: null });

    const error = await errorOf(t.service.deactivate(owner, TABLE_ID));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(t.reservations.findActiveForTable).not.toHaveBeenCalled();
  });

  it('b. ya inactiva: 409 sin errorCode, antes de revisar la reserva', async () => {
    const t = setup({
      table: row({ isActive: false }),
      reservation: { partySize: 2 },
    });

    const error = await errorOf(t.service.deactivate(owner, TABLE_ID));

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe(TABLE_ALREADY_INACTIVE_MESSAGE);
    expect(error).not.toMatchObject({
      response: { errorCode: expect.anything() },
    });
    expect(t.reservations.findActiveForTable).not.toHaveBeenCalled();
  });

  it('c. reserva DiNNo activa → TABLE_HAS_ACTIVE_RESERVATION y la mesa queda intacta', async () => {
    const t = setup({
      table: row({ status: 'reserved' }),
      reservation: { partySize: 2 },
    });

    const error = await errorOf(t.service.deactivate(owner, TABLE_ID));

    expect(error).toMatchObject(hasActiveReservation);
    expect(t.manager.save).not.toHaveBeenCalled();
    expect(t.statusLog.record).not.toHaveBeenCalled();
    expect(t.events.emit).not.toHaveBeenCalled();
  });

  it.each(['reserved', 'occupied'] as const)(
    'd. mesa %s a mano → TABLE_NOT_AVAILABLE_TO_DEACTIVATE (primero se pasa a Disponible)',
    async (status) => {
      const t = setup({ table: row({ status }), reservation: null });

      const error = await errorOf(t.service.deactivate(owner, TABLE_ID));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        status: 409,
        response: {
          errorCode: TABLE_NOT_AVAILABLE_TO_DEACTIVATE_CODE,
          message: TABLE_NOT_AVAILABLE_TO_DEACTIVATE_MESSAGE,
        },
      });
      expect((error as Error).message).toBe(
        'Para desactivar esta mesa, primero márcala como Disponible.',
      );
      expect(t.manager.save).not.toHaveBeenCalled();
      expect(t.statusLog.record).not.toHaveBeenCalled();
    },
  );

  it('ambos 409 aplican (reserva activa y no available) → gana TABLE_HAS_ACTIVE_RESERVATION', async () => {
    // Una mesa con reserva DiNNo está en reserved: los dos motivos coinciden.
    const t = setup({
      table: row({ status: 'reserved' }),
      reservation: { partySize: 2 },
    });

    const error = await errorOf(t.service.deactivate(owner, TABLE_ID));

    expect(error).toMatchObject({
      response: { errorCode: TABLE_HAS_ACTIVE_RESERVATION_CODE },
    });
    expect(error).not.toMatchObject({
      response: { errorCode: TABLE_NOT_AVAILABLE_TO_DEACTIVATE_CODE },
    });
  });

  it('e. mesa available sin reserva: se desactiva y registra available → inactive', async () => {
    const t = setup({ table: row({ status: 'available' }), reservation: null });

    const result = await t.service.deactivate(owner, TABLE_ID);

    expect(result.isActive).toBe(false);
    expect(t.statusLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        previousStatus: 'available',
        newStatus: 'inactive',
        userId: USER_ID,
        source: 'manual',
      }),
      t.manager,
    );
    expect(t.events.emit).toHaveBeenCalledTimes(1);
  });

  it('vence primero una reserva debida, y comprueba la reserva después de bloquear la mesa', async () => {
    const t = setup();

    await t.service.deactivate(owner, TABLE_ID);

    expect(t.log.slice(0, 4)).toEqual([
      'expire',
      'begin',
      'lock-table',
      'find-reservation',
    ]);
  });

  it('reactivar no consulta reservas ni vence nada', async () => {
    const t = setup({ table: row({ isActive: false, status: 'available' }) });

    const result = await t.service.reactivate(owner, TABLE_ID);

    expect(result.isActive).toBe(true);
    expect(t.reservations.expireDueForTable).not.toHaveBeenCalled();
    expect(t.reservations.findActiveForTable).not.toHaveBeenCalled();
  });
});

describe('TablesService · editar (§12.2)', () => {
  it('cambiar solo el identificador siempre se permite, con reserva activa, y no consulta reservas', async () => {
    const t = setup({ reservation: { partySize: 6 } });

    const result = await t.service.update(RESTAURANT_ID, TABLE_ID, {
      identifier: '12',
    });

    expect(result.identifier).toBe('12');
    expect(t.reservations.expireDueForTable).not.toHaveBeenCalled();
    expect(t.reservations.findActiveForTable).not.toHaveBeenCalled();
  });

  it('bajar la capacidad por debajo de las personas de la reserva → 409 TABLE_HAS_ACTIVE_RESERVATION', async () => {
    const t = setup({
      table: row({ capacity: 8, status: 'reserved' }),
      reservation: { partySize: 4 },
    });

    const error = await errorOf(
      t.service.update(RESTAURANT_ID, TABLE_ID, { capacity: 3 }),
    );

    expect(error).toMatchObject(hasActiveReservation);
    expect(t.manager.update).not.toHaveBeenCalled();
  });

  it('capacidad igual a las personas de la reserva: permitida', async () => {
    const t = setup({
      table: row({ capacity: 8, status: 'reserved' }),
      reservation: { partySize: 4 },
    });

    const result = await t.service.update(RESTAURANT_ID, TABLE_ID, {
      capacity: 4,
    });

    expect(result.capacity).toBe(4);
  });

  it('capacidad por encima de las personas de la reserva: permitida', async () => {
    const t = setup({ reservation: { partySize: 2 } });

    await expect(
      t.service.update(RESTAURANT_ID, TABLE_ID, { capacity: 6 }),
    ).resolves.toMatchObject({ capacity: 6 });
  });

  it('sin reserva activa, bajar la capacidad se permite como antes', async () => {
    const t = setup({ reservation: null });

    await expect(
      t.service.update(RESTAURANT_ID, TABLE_ID, { capacity: 1 }),
    ).resolves.toMatchObject({ capacity: 1 });
  });

  it('con identificador y capacidad juntos, la capacidad manda: por debajo de la reserva es 409 y no cambia ni el identificador', async () => {
    const t = setup({ reservation: { partySize: 4 } });

    const error = await errorOf(
      t.service.update(RESTAURANT_ID, TABLE_ID, {
        identifier: '12',
        capacity: 2,
      }),
    );

    expect(error).toMatchObject(hasActiveReservation);
    expect(t.manager.update).not.toHaveBeenCalled();
  });

  it('vence una reserva debida antes de la transacción y la comprueba tras el bloqueo', async () => {
    const t = setup();

    await t.service.update(RESTAURANT_ID, TABLE_ID, { capacity: 5 });

    expect(t.log.slice(0, 4)).toEqual([
      'expire',
      'begin',
      'lock-table',
      'find-reservation',
    ]);
  });
});

describe('TablesService · mesa de otro restaurante (vencer antes de la transacción no filtra nada)', () => {
  const FOREIGN_TABLE = '7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d';

  const actions: [string, (t: Setup) => Promise<unknown>][] = [
    [
      'cambiar estado',
      (t) => t.service.updateStatus(owner, FOREIGN_TABLE, 'available'),
    ],
    ['desactivar', (t) => t.service.deactivate(owner, FOREIGN_TABLE)],
    [
      'editar la capacidad',
      (t) => t.service.update(RESTAURANT_ID, FOREIGN_TABLE, { capacity: 2 }),
    ],
  ];

  it.each(actions)(
    '%s: responde el mismo 404 que una mesa que no existe, tenga o no reserva',
    async (_action, act) => {
      // El bloqueo filtra por el restaurante de la sesión: la mesa ajena no aparece.
      const withReservation = setup({
        table: null,
        reservation: { partySize: 2 },
      });
      const withoutReservation = setup({ table: null, reservation: null });

      const foreign = await errorOf(act(withReservation));
      const unknown = await errorOf(act(withoutReservation));

      expect(foreign).toBeInstanceOf(NotFoundException);
      expect((foreign as Error).message).toBe(TABLE_NOT_FOUND_MESSAGE);
      expect(foreign).toEqual(unknown);
      // Nada de la reserva ajena llega a la respuesta.
      expect(JSON.stringify(foreign)).not.toContain('reserva');
      expect(
        withReservation.reservations.findActiveForTable,
      ).not.toHaveBeenCalled();
    },
  );
});
