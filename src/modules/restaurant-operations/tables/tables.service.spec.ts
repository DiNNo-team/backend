import { ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { CreateTableDto } from './dto/create-table.dto.js';
import type { Table } from './table.entity.js';
import type { TableStatusLog } from './table-status-log.js';
import { RESTAURANT_REQUIRED_MESSAGE } from '../shared/restaurant-required.js';
import { TablesService } from './tables.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';

function pgError(code: string, constraint: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "tables" ...',
    [],
    Object.assign(new Error('duplicate key value'), { code, constraint }),
  );
}

function createService() {
  const tables = {
    create: vi.fn((data: Partial<Table>) => ({ ...data }) as Table),
    save: vi.fn((table: Table) =>
      Promise.resolve({
        ...table,
        id: TABLE_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    find: vi.fn(() => Promise.resolve([] as Table[])),
  };
  const service = new TablesService(
    tables as unknown as Repository<Table>,
    { record: vi.fn() } as unknown as TableStatusLog,
  );
  return { service, tables };
}

describe('TablesService', () => {
  describe('create', () => {
    it('creates an available, active table in the user restaurant', async () => {
      const { service, tables } = createService();

      const table = await service.create(RESTAURANT_ID, {
        identifier: 'Mesa 4',
        capacity: 4,
      });

      expect(tables.save).toHaveBeenCalledWith({
        restaurantId: RESTAURANT_ID,
        identifier: 'Mesa 4',
        capacity: 4,
        status: 'available',
        isActive: true,
      });
      expect(table).toMatchObject({
        id: TABLE_ID,
        restaurantId: RESTAURANT_ID,
        status: 'available',
        isActive: true,
      });
    });

    it('stores the identifier without surrounding spaces', async () => {
      const { service, tables } = createService();

      await service.create(RESTAURANT_ID, {
        identifier: '   Terraza 2  ',
        capacity: 2,
      });

      expect(tables.save).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'Terraza 2' }),
      );
    });

    it('ignores restaurantId, status and isActive coming in the dto', async () => {
      const { service, tables } = createService();
      const tamperedDto = {
        identifier: 'Mesa 1',
        capacity: 2,
        restaurantId: OTHER_RESTAURANT_ID,
        status: 'occupied',
        isActive: false,
      } as unknown as CreateTableDto;

      await service.create(RESTAURANT_ID, tamperedDto);

      expect(tables.save).toHaveBeenCalledWith({
        restaurantId: RESTAURANT_ID,
        identifier: 'Mesa 1',
        capacity: 2,
        status: 'available',
        isActive: true,
      });
    });

    it('turns a duplicate identifier into a 409 with a clear message', async () => {
      const { service, tables } = createService();
      tables.save.mockRejectedValueOnce(
        pgError('23505', 'UQ_tables_restaurant_id_identifier'),
      );

      const result = service.create(RESTAURANT_ID, {
        identifier: 'mesa 4',
        capacity: 4,
      });

      await expect(result).rejects.toBeInstanceOf(ConflictException);
      await expect(result).rejects.toThrow(
        'Ya tienes una Mesa 04. Usa otro identificador.',
      );
    });

    it('rethrows other database errors unchanged', async () => {
      const { service, tables } = createService();
      const otherError = pgError('23503', 'FK_77e362d578933cf4518770d11ae');
      tables.save.mockRejectedValueOnce(otherError);

      await expect(
        service.create(RESTAURANT_ID, { identifier: 'Mesa 4', capacity: 4 }),
      ).rejects.toBe(otherError);
    });

    it('rejects a user without a restaurant and saves nothing', async () => {
      const { service, tables } = createService();

      const result = service.create(null, {
        identifier: 'Mesa 4',
        capacity: 4,
      });

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toMatchObject({
        response: {
          statusCode: 403,
          error: 'Forbidden',
          message: RESTAURANT_REQUIRED_MESSAGE,
          errorCode: 'RESTAURANT_REQUIRED',
        },
      });
      expect(tables.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns active and inactive tables of the user restaurant only', async () => {
      const { service, tables } = createService();
      const rows = [
        { identifier: 'Mesa 1', isActive: true },
        { identifier: 'Mesa 2', isActive: false },
      ] as Table[];
      tables.find.mockResolvedValueOnce(rows);

      await expect(service.findAll(RESTAURANT_ID)).resolves.toBe(rows);
      const [options] = tables.find.mock.calls[0] as unknown as [
        { where: object },
      ];
      // Filters by restaurant only: no isActive filter, so inactive ones come too.
      expect(options.where).toEqual({ restaurantId: RESTAURANT_ID });
    });

    it('orders by creation date ascending, with id as tie-breaker', async () => {
      const { service, tables } = createService();

      await service.findAll(RESTAURANT_ID);

      expect(tables.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { createdAt: 'ASC', id: 'ASC' } }),
      );
    });

    it('rejects a user without a restaurant', async () => {
      const { service, tables } = createService();

      const result = service.findAll(null);

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toMatchObject({
        response: { errorCode: 'RESTAURANT_REQUIRED' },
      });
      expect(tables.find).not.toHaveBeenCalled();
    });
  });
});
