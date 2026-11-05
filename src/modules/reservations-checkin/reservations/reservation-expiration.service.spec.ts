import type { EventEmitter2 } from '@nestjs/event-emitter';
import { UpdateQueryBuilder, type DataSource } from 'typeorm';
import { createMetadataOnlyDataSource } from '../../../../test/support/typeorm-metadata.js';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type TableStatusLog,
} from '../../restaurant-operations/index.js';
import type { Clock } from '../../search-availability/index.js';
import { ReservationExpirationService } from './reservation-expiration.service.js';
import { Reservation } from './reservation.entity.js';

const RESERVATION_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const OTHER_RESTAURANT_ID = '9f4a6b5d-1e0a-4f8b-823d-4e5f60718293';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

// Columnas que el servicio lee de cada fila del RETURNING (ExpiredRow).
const COLUMNS_READ = ['id', 'table_id', 'restaurant_id'];

// Fila completa de la tabla reservations, con los nombres de columna de la
// base. Lleva columnas de más a propósito: el RETURNING solo devuelve las que
// el SQL pide, y la prueba depende de eso.
const record = (
  tableId: string,
  restaurantId = RESTAURANT_ID,
  id = RESERVATION_ID,
) => ({
  id,
  table_id: tableId,
  restaurant_id: restaurantId,
  diner_id: DINER_ID,
  status: 'expired',
  no_show: true,
});

type DbRecord = ReturnType<typeof record>;

// Lo que devuelve Postgres para un UPDATE ... RETURNING: filas con EXACTAMENTE
// las columnas del RETURNING del SQL y con los nombres de la base. Sin
// RETURNING, ninguna fila. Así el doble no repite lo que el código supone: si
// el código pide mal las columnas, las filas llegan sin ellas, como en TypeORM.
function postgresRows(sql: string, records: DbRecord[]) {
  const clause = /RETURNING (.+)$/.exec(sql)?.[1];
  if (!clause) {
    return [];
  }
  const columns = clause.split(',').map((c) => c.trim().replace(/"/g, ''));
  return records.map((row) =>
    Object.fromEntries(
      columns.map((column) => [column, row[column as keyof DbRecord]]),
    ),
  );
}

interface Options {
  // Filas que debería devolver el UPDATE ... RETURNING (las que vence).
  expiredRows?: DbRecord[];
  // Mesas que siguen en reserved (el UPDATE de la mesa afecta una fila).
  // Por defecto, todas.
  stillReserved?: (tableId: string) => boolean;
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
  const log: string[] = [];
  const executed: { sql: string; params: unknown[] }[] = [];

  // El query builder es el REAL de TypeORM (arma el SQL de verdad, con los
  // metadatos de las entidades); solo se corta la ida a la base: execute()
  // registra el SQL y responde como lo haría Postgres.
  vi.spyOn(UpdateQueryBuilder.prototype, 'execute').mockImplementation(
    function (this: UpdateQueryBuilder<Reservation>) {
      const [sql, params] = this.getQueryAndParameters();
      executed.push({ sql, params });
      log.push('update-reservations');
      const raw = postgresRows(sql, options.expiredRows ?? []);
      return Promise.resolve({ raw, affected: raw.length, generatedMaps: [] });
    } as never,
  );

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
      log.push(`update-table:${String(criteria.id)}`);
      const affected =
        (options.stillReserved?.(String(criteria.id)) ?? true) ? 1 : 0;
      return Promise.resolve({ affected });
    }),
  };
  const manager = {
    createQueryBuilder: () => metadataDataSource.createQueryBuilder(),
    getRepository: vi.fn(() => tablesRepo),
  };
  const dataSource = {
    transaction: vi.fn(async (work: (m: unknown) => Promise<unknown>) => {
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
  const service = new ReservationExpirationService(
    dataSource as unknown as DataSource,
    statusLog as unknown as TableStatusLog,
    events as unknown as EventEmitter2,
    { now: () => NOW } as Clock,
  );
  return {
    service,
    log,
    executed,
    manager,
    tablesRepo,
    statusLog,
    events,
    dataSource,
  };
}

// El núcleo aún no se expone (la tarea 6 agrega expireAllDue sobre él): se
// prueba por el cast para fijar que sin scope vence todas las debidas.
const expireDue = (service: ReservationExpirationService, scope: object) =>
  (
    service as unknown as { expireDue: (s: object) => Promise<number> }
  ).expireDue(scope);

describe('ReservationExpirationService', () => {
  describe('vence una reserva debida', () => {
    it('reserva, mesa y bitácora en la misma transacción, con el evento solo después del commit', async () => {
      const t = setup({ expiredRows: [record('t-4')] });

      const expired = await t.service.expireIfDue(RESERVATION_ID);

      expect(expired).toBe(1);
      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(t.log).toEqual([
        'update-reservations',
        'update-table:t-4',
        'log',
        'commit',
        'emit',
      ]);
      expect(t.events.emit).toHaveBeenCalledWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        { restaurantId: RESTAURANT_ID },
      );
    });

    it('marca la reserva como expired con la hora del Clock y no_show (SQL real de TypeORM)', async () => {
      const t = setup({ expiredRows: [record('t-4')] });

      await t.service.expireIfDue(RESERVATION_ID);

      const [{ sql, params }] = t.executed;
      expect(sql).toMatch(/^UPDATE "reservations" SET /);
      expect(sql).toContain(
        'SET "status" = $1, "expired_at" = $2, "no_show" = $3',
      );
      expect(params.slice(0, 3)).toEqual(['expired', NOW, true]);
    });

    it('la condición va en el UPDATE: solo activas con expires_at <= ahora (idempotente)', async () => {
      const t = setup();

      await t.service.expireIfDue(RESERVATION_ID);

      const [{ sql, params }] = t.executed;
      expect(sql).toContain(`WHERE "status" = 'active' AND "expires_at" <= $4`);
      expect(params[3]).toEqual(NOW);
    });

    it('la mesa vuelve a available solo si sigue en reserved (la condición va en el UPDATE)', async () => {
      const t = setup({ expiredRows: [record('t-4')] });

      await t.service.expireIfDue(RESERVATION_ID);

      expect(t.tablesRepo.update).toHaveBeenCalledWith(
        { id: 't-4', status: 'reserved' },
        { status: 'available' },
      );
    });

    it('escribe la bitácora automática: source system, sin usuario, reserved → available, con el manager de la transacción', async () => {
      const t = setup({ expiredRows: [record('t-4')] });

      await t.service.expireIfDue(RESERVATION_ID);

      expect(t.statusLog.record).toHaveBeenCalledWith(
        {
          tableId: 't-4',
          previousStatus: 'reserved',
          newStatus: 'available',
          userId: null,
          source: 'system',
          changedAt: NOW,
        },
        t.manager,
      );
    });
  });

  describe('forma real del RETURNING de TypeORM', () => {
    it('pide en el RETURNING exactamente las columnas que lee de cada fila', async () => {
      const t = setup({ expiredRows: [record('t-4')] });

      await t.service.expireIfDue(RESERVATION_ID);

      const [{ sql }] = t.executed;
      expect(sql).toMatch(/RETURNING "id", "table_id", "restaurant_id"$/);
      const returned = /RETURNING (.+)$/
        .exec(sql)![1]
        .split(',')
        .map((column) => column.trim().replace(/"/g, ''));
      expect(returned).toEqual(COLUMNS_READ);
    });

    it('el doble devuelve solo las columnas del RETURNING: sin table_id en el SQL, la mesa llega undefined y falla como en la base real', () => {
      const rows = postgresRows('UPDATE "reservations" ... RETURNING "id"', [
        record('t-4'),
      ]);

      expect(rows).toEqual([{ id: RESERVATION_ID }]);
      expect(rows[0]).not.toHaveProperty('table_id');
    });

    // Documenta la causa del fallo contra la base real: en un ARREGLO, TypeORM
    // toma cada elemento como nombre de PROPIEDAD de la entidad y descarta en
    // silencio lo que no encuentra. Si TypeORM cambia esto, esta prueba avisa.
    it('TypeORM: returning([...]) con nombres de columna descarta table_id y restaurant_id', () => {
      const build = (returning: string | string[]) =>
        metadataDataSource
          .createQueryBuilder()
          .update(Reservation)
          .set({ status: 'expired' })
          .where('"id" = :id', { id: RESERVATION_ID })
          .returning(returning)
          .getQuery();

      expect(build(['id', 'table_id', 'restaurant_id'])).toMatch(
        /RETURNING "id"$/,
      );
      // Con nombres de propiedad sí los devuelve; con un texto pasa tal cual.
      expect(build(['id', 'tableId', 'restaurantId'])).toMatch(
        /RETURNING "id", "table_id", "restaurant_id"$/,
      );
      expect(build('"id", "table_id", "restaurant_id"')).toMatch(
        /RETURNING "id", "table_id", "restaurant_id"$/,
      );
    });
  });

  describe('lo que no debe tocar', () => {
    it('reserva no debida, ya cancelada o ya completada (el UPDATE no devuelve filas): no hace nada más', async () => {
      const t = setup({ expiredRows: [] });

      const expired = await t.service.expireIfDue(RESERVATION_ID);

      expect(expired).toBe(0);
      expect(t.tablesRepo.update).not.toHaveBeenCalled();
      expect(t.statusLog.record).not.toHaveBeenCalled();
      expect(t.events.emit).not.toHaveBeenCalled();
    });

    it('mesa que ya no está reserved: la reserva queda vencida pero la mesa no se pisa, sin bitácora ni evento', async () => {
      const t = setup({
        expiredRows: [record('t-4')],
        stillReserved: () => false,
      });

      const expired = await t.service.expireIfDue(RESERVATION_ID);

      expect(expired).toBe(1);
      expect(t.tablesRepo.update).toHaveBeenCalledTimes(1);
      expect(t.statusLog.record).not.toHaveBeenCalled();
      expect(t.events.emit).not.toHaveBeenCalled();
      expect(t.log).toEqual([
        'update-reservations',
        'update-table:t-4',
        'commit',
      ]);
    });

    it('si la bitácora falla, todo se revierte y no se emite nada', async () => {
      const t = setup({ expiredRows: [record('t-4')], logFails: true });

      await expect(t.service.expireIfDue(RESERVATION_ID)).rejects.toThrow(
        'log roto',
      );

      expect(t.log).toContain('rollback');
      expect(t.log).not.toContain('commit');
      expect(t.events.emit).not.toHaveBeenCalled();
    });
  });

  describe('alcance', () => {
    it('expireIfDue filtra por la reserva', async () => {
      const t = setup();

      await t.service.expireIfDue(RESERVATION_ID);

      const [{ sql, params }] = t.executed;
      expect(sql).toContain(`AND "id" = $5`);
      expect(params[4]).toBe(RESERVATION_ID);
    });

    it('expireDueForDiner filtra por el comensal', async () => {
      const t = setup();

      await t.service.expireDueForDiner(DINER_ID);

      const [{ sql, params }] = t.executed;
      expect(sql).toContain(`AND "diner_id" = $5`);
      expect(params[4]).toBe(DINER_ID);
    });

    it('expireDueForTable filtra por la mesa (acciones del restaurante, §12.2)', async () => {
      const t = setup();

      await t.service.expireDueForTable('t-4');

      const [{ sql, params }] = t.executed;
      expect(sql).toContain('AND "table_id" = $5');
      expect(params[4]).toBe('t-4');
    });

    it('sin scope vence todas las debidas (lo que usará expireAllDue en la tarea 6)', async () => {
      const t = setup({
        expiredRows: [
          record('t-1', RESTAURANT_ID, 'r-1'),
          record('t-2', OTHER_RESTAURANT_ID, 'r-2'),
          record('t-3', RESTAURANT_ID, 'r-3'),
        ],
      });

      const expired = await expireDue(t.service, {});

      expect(expired).toBe(3);
      const [{ sql, params }] = t.executed;
      // Solo los parámetros del SET (3) y de la condición de vencimiento (1).
      expect(sql).not.toContain('$5');
      expect(params).toHaveLength(4);
      expect(sql).toContain(`WHERE "status" = 'active' AND "expires_at" <= $4`);
      expect(t.statusLog.record).toHaveBeenCalledTimes(3);
      // Un solo commit y un evento por restaurante afectado, no por mesa.
      expect(t.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(t.events.emit).toHaveBeenCalledTimes(2);
      expect(t.events.emit).toHaveBeenCalledWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        { restaurantId: RESTAURANT_ID },
      );
      expect(t.events.emit).toHaveBeenCalledWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        { restaurantId: OTHER_RESTAURANT_ID },
      );
    });

    it('sin scope, el restaurante solo se notifica si alguna de sus mesas cambió', async () => {
      const t = setup({
        expiredRows: [
          record('t-1', RESTAURANT_ID, 'r-1'),
          record('t-2', OTHER_RESTAURANT_ID, 'r-2'),
        ],
        stillReserved: (tableId) => tableId === 't-1',
      });

      await expireDue(t.service, {});

      expect(t.statusLog.record).toHaveBeenCalledTimes(1);
      expect(t.events.emit).toHaveBeenCalledTimes(1);
      expect(t.events.emit).toHaveBeenCalledWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        { restaurantId: RESTAURANT_ID },
      );
    });
  });
});
