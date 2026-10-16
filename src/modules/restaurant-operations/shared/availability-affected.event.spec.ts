import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Repository } from 'typeorm';
import { UserRole, type CurrentUserData } from '../../identity-access/index.js';
import type { UpdateRestaurantDto } from '../restaurants/dto/update-restaurant.dto.js';
import { RestaurantEditService } from '../restaurants/restaurant-edit.service.js';
import { RestaurantStatusService } from '../restaurants/restaurant-status.service.js';
import type { Restaurant } from '../restaurants/restaurant.entity.js';
import type { TableStatusLog } from '../tables/table-status-log.js';
import type { Table } from '../tables/table.entity.js';
import { TablesService } from '../tables/tables.service.js';
import { RESTAURANT_AVAILABILITY_AFFECTED } from './availability-affected.event.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';

const owner: CurrentUserData = {
  userId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  restaurantId: RESTAURANT_ID,
  role: UserRole.RESTAURANT_ADMIN,
};

// Every write and commit, and every emit, in the order they happen: the event
// must come after the commit, never inside the transaction.
function timeline() {
  const steps: string[] = [];
  const events = {
    emit: vi.fn((name: string, payload: unknown) => {
      steps.push(`emit ${name} ${JSON.stringify(payload)}`);
      return true;
    }),
  };
  // Runs the work like a transaction: "commit" only if it resolves.
  const transaction = vi.fn(async (work: (m: unknown) => Promise<unknown>) => {
    const result = await work(manager);
    steps.push('commit');
    return result;
  });
  const manager: Record<string, ReturnType<typeof vi.fn>> = {};
  return {
    steps,
    events,
    manager,
    transaction,
    emitter: events as unknown as EventEmitter2,
  };
}

const EMITTED = `emit ${RESTAURANT_AVAILABILITY_AFFECTED} ${JSON.stringify({ restaurantId: RESTAURANT_ID })}`;

describe('availability event of restaurant-operations', () => {
  describe('TablesService', () => {
    function tablesFixture(stored: Partial<Table>, recordFails = false) {
      const t = timeline();
      t.manager.findOne = vi.fn(() => Promise.resolve({ ...stored }));
      t.manager.save = vi.fn((table: Table) => {
        t.steps.push('save');
        return Promise.resolve({ ...table });
      });
      const statusLog = {
        record: vi.fn(() =>
          recordFails
            ? Promise.reject(new Error('log insert failed'))
            : Promise.resolve(),
        ),
      } as unknown as TableStatusLog;
      const tables = {
        manager: { transaction: t.transaction },
        create: vi.fn((data: Partial<Table>) => data),
        save: vi.fn((table: Table) => {
          t.steps.push('save');
          return Promise.resolve({ ...table, id: TABLE_ID });
        }),
        find: vi.fn(() => Promise.resolve([])),
      };
      const service = new TablesService(
        tables as unknown as Repository<Table>,
        statusLog,
        t.emitter,
      );
      return { ...t, service };
    }

    const activeAvailable = {
      id: TABLE_ID,
      restaurantId: RESTAURANT_ID,
      identifier: '04',
      capacity: 4,
      status: 'available' as const,
      isActive: true,
    };

    it('creating a table emits after it is saved', async () => {
      const { service, steps } = tablesFixture(activeAvailable);

      await service.create(RESTAURANT_ID, { identifier: '05', capacity: 2 });

      expect(steps).toEqual(['save', EMITTED]);
    });

    it('a status change emits after the commit', async () => {
      const { service, steps } = tablesFixture(activeAvailable);

      await service.updateStatus(owner, TABLE_ID, 'occupied');

      expect(steps).toEqual(['save', 'commit', EMITTED]);
    });

    it('asking for the status the table already has emits nothing', async () => {
      const { service, events } = tablesFixture(activeAvailable);

      await service.updateStatus(owner, TABLE_ID, 'available');

      expect(events.emit).not.toHaveBeenCalled();
    });

    it('a status change whose transaction fails emits nothing', async () => {
      const { service, events, steps } = tablesFixture(activeAvailable, true);

      await expect(
        service.updateStatus(owner, TABLE_ID, 'occupied'),
      ).rejects.toThrow('log insert failed');
      expect(steps).not.toContain('commit');
      expect(events.emit).not.toHaveBeenCalled();
    });

    it.each([
      ['deactivating', activeAvailable, 'deactivate'],
      ['reactivating', { ...activeAvailable, isActive: false }, 'reactivate'],
    ] as const)('%s emits after the commit', async (_case, stored, action) => {
      const { service, steps } = tablesFixture(stored);

      await service[action](owner, TABLE_ID);

      expect(steps).toEqual(['save', 'commit', EMITTED]);
    });

    it('deactivating an inactive table (409) emits nothing', async () => {
      const { service, events } = tablesFixture({
        ...activeAvailable,
        isActive: false,
      });

      await expect(service.deactivate(owner, TABLE_ID)).rejects.toThrow();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('editing the identifier or the capacity emits nothing', async () => {
      const { service, events, manager } = tablesFixture(activeAvailable);
      manager.update = vi.fn(() => Promise.resolve({ affected: 1 }));

      await service.update(RESTAURANT_ID, TABLE_ID, { capacity: 6 });

      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('RestaurantStatusService', () => {
    function statusFixture(isOpen: boolean, updateFails = false) {
      const t = timeline();
      let stored = { id: RESTAURANT_ID, isOpen } as Restaurant;
      const restaurants = {
        findOneBy: vi.fn(() => Promise.resolve({ ...stored })),
        update: vi.fn((_where: unknown, changes: Partial<Restaurant>) => {
          if (updateFails) {
            return Promise.reject(new Error('database down'));
          }
          t.steps.push('update');
          stored = { ...stored, ...changes };
          return Promise.resolve({ affected: 1 });
        }),
      };
      const service = new RestaurantStatusService(
        restaurants as unknown as Repository<Restaurant>,
        t.emitter,
      );
      return { ...t, service, restaurants };
    }

    it('closing an open restaurant emits after the update', async () => {
      const { service, steps } = statusFixture(true);

      await service.update(RESTAURANT_ID, false);

      expect(steps).toEqual(['update', EMITTED]);
    });

    it('sending the state it already has writes and emits nothing', async () => {
      const { service, events, restaurants } = statusFixture(false);

      await expect(service.update(RESTAURANT_ID, false)).resolves.toMatchObject(
        { isOpen: false },
      );
      expect(restaurants.update).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('a failed update emits nothing', async () => {
      const { service, events } = statusFixture(true, true);

      await expect(service.update(RESTAURANT_ID, false)).rejects.toThrow();
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('RestaurantEditService', () => {
    const CASA_72 = { latitude: 4.655671, longitude: -74.057006 };

    function editFixture(stored: Partial<Restaurant>, saveFails = false) {
      const t = timeline();
      t.manager.findOne = vi.fn(() => Promise.resolve({ ...stored }));
      t.manager.merge = vi.fn(
        (_entity: unknown, target: object, ...sources: object[]) =>
          Object.assign(target, ...sources),
      );
      t.manager.save = vi.fn((entity: unknown) => {
        if (saveFails) {
          return Promise.reject(new Error('database down'));
        }
        t.steps.push('save');
        return Promise.resolve(entity);
      });
      t.manager.find = vi.fn(() => Promise.resolve([]));
      t.manager.delete = vi.fn(() => Promise.resolve({ affected: 1 }));
      t.manager.create = vi.fn((_entity: unknown, data: object) => data);
      const restaurants = { manager: { transaction: t.transaction } };
      const service = new RestaurantEditService(
        restaurants as unknown as Repository<Restaurant>,
        t.emitter,
      );
      return { ...t, service };
    }

    const stored = {
      id: RESTAURANT_ID,
      name: 'Casa 72',
      latitude: null,
      longitude: null,
    };

    it('setting the location emits after the commit', async () => {
      const { service, steps } = editFixture(stored);

      await service.update(RESTAURANT_ID, CASA_72 as UpdateRestaurantDto);

      expect(steps).toEqual(['save', 'commit', EMITTED]);
    });

    it('replacing the hours emits after the commit', async () => {
      const { service, steps } = editFixture(stored);

      await service.update(RESTAURANT_ID, {
        schedules: [{ dayOfWeek: 1, isOpen24h: true }],
      } as UpdateRestaurantDto);

      expect(steps.at(-2)).toBe('commit');
      expect(steps.at(-1)).toBe(EMITTED);
    });

    it.each([
      ['the name', { name: 'Casa 72 Chapinero' }],
      [
        'the category and the address',
        { category: 'grill', address: 'Cra. 9' },
      ],
    ])('editing only %s emits nothing', async (_case, dto) => {
      const { service, events } = editFixture(stored);

      await service.update(RESTAURANT_ID, dto as UpdateRestaurantDto);

      expect(events.emit).not.toHaveBeenCalled();
    });

    it('sending the same location it has emits nothing', async () => {
      const { service, events } = editFixture({ ...stored, ...CASA_72 });

      await service.update(RESTAURANT_ID, {
        name: 'Otro nombre',
        ...CASA_72,
      } as UpdateRestaurantDto);

      expect(events.emit).not.toHaveBeenCalled();
    });

    it('a failed transaction emits nothing', async () => {
      const { service, events } = editFixture(stored, true);

      await expect(
        service.update(RESTAURANT_ID, CASA_72 as UpdateRestaurantDto),
      ).rejects.toThrow('database down');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });
});
