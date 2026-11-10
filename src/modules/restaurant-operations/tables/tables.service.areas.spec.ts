import { fakeTableReservations } from '../../../../test/support/table-reservations.js';
import { NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Repository } from 'typeorm';
import { AREA_NOT_FOUND_MESSAGE } from '../table-areas/table-area-rules.js';
import type { Table } from './table.entity.js';
import type { TableStatusLog } from './table-status-log.js';
import { TablesService } from './tables.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const TERRACE_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const BAR_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const FOREIGN_AREA_ID = '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9';

// Zones of the restaurant; FOREIGN_AREA_ID belongs to another one.
const OWN_AREAS = [TERRACE_ID, BAR_ID];

function placedTable(): Table {
  return {
    id: TABLE_ID,
    restaurantId: RESTAURANT_ID,
    areaId: TERRACE_ID,
    identifier: '04',
    capacity: 4,
    status: 'available',
    isActive: true,
    planX: 3,
    planY: 5,
    planShape: 'round',
    createdAt: new Date('2026-11-10T12:00:00Z'),
    updatedAt: new Date('2026-11-10T12:00:00Z'),
  };
}

describe('TablesService · zones', () => {
  let manager: {
    count: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let tables: {
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    manager: typeof manager & { transaction: ReturnType<typeof vi.fn> };
  };
  let service: TablesService;

  beforeEach(() => {
    manager = {
      count: vi.fn(
        (
          _entity: unknown,
          { where }: { where: { id: string; restaurantId: string } },
        ) =>
          Promise.resolve(
            where.restaurantId === RESTAURANT_ID && OWN_AREAS.includes(where.id)
              ? 1
              : 0,
          ),
      ),
      findOne: vi.fn(() => Promise.resolve(placedTable())),
      update: vi.fn(() => Promise.resolve({ affected: 1 })),
    };
    tables = {
      find: vi.fn(() => Promise.resolve([])),
      create: vi.fn((values: Partial<Table>) => values),
      save: vi.fn((values: Partial<Table>) =>
        Promise.resolve({ ...values, id: TABLE_ID }),
      ),
      manager: {
        ...manager,
        transaction: vi.fn((work: (m: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      },
    };
    service = new TablesService(
      tables as unknown as Repository<Table>,
      { record: vi.fn() } as unknown as TableStatusLog,
      { emit: vi.fn() } as unknown as EventEmitter2,
      fakeTableReservations(),
    );
  });

  describe('create', () => {
    it('creates the table in a zone of the restaurant', async () => {
      await service.create(RESTAURANT_ID, {
        identifier: '04',
        capacity: 4,
        areaId: TERRACE_ID,
      });

      expect(tables.save).toHaveBeenCalledWith(
        expect.objectContaining({ areaId: TERRACE_ID }),
      );
    });

    it('answers 404 for a zone of another restaurant and saves nothing', async () => {
      await expect(
        service.create(RESTAURANT_ID, {
          identifier: '04',
          capacity: 4,
          areaId: FOREIGN_AREA_ID,
        }),
      ).rejects.toThrow(new NotFoundException(AREA_NOT_FOUND_MESSAGE));
      expect(tables.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('moves the table to another zone and takes it off the plan', async () => {
      const table = await service.update(RESTAURANT_ID, TABLE_ID, {
        areaId: BAR_ID,
      });

      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: TABLE_ID, restaurantId: RESTAURANT_ID },
        { areaId: BAR_ID, planX: null, planY: null, planShape: null },
      );
      expect(table).toMatchObject({ areaId: BAR_ID, planX: null });
    });

    it('takes the table out of its zone with null, without checking any zone', async () => {
      await service.update(RESTAURANT_ID, TABLE_ID, { areaId: null });

      expect(manager.count).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { areaId: null, planX: null, planY: null, planShape: null },
      );
    });

    it('keeps the place on the plan when the zone does not change', async () => {
      const table = await service.update(RESTAURANT_ID, TABLE_ID, {
        areaId: TERRACE_ID,
        capacity: 6,
      });

      expect(manager.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { capacity: 6 },
      );
      expect(table).toMatchObject({ planX: 3, planY: 5, planShape: 'round' });
    });

    it('answers 404 for a zone of another restaurant and changes nothing', async () => {
      await expect(
        service.update(RESTAURANT_ID, TABLE_ID, { areaId: FOREIGN_AREA_ID }),
      ).rejects.toThrow(new NotFoundException(AREA_NOT_FOUND_MESSAGE));
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});
