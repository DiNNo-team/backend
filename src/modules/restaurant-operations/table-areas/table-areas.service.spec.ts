import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
  AREA_NOT_FOUND_MESSAGE,
  AREAS_LIMIT_MESSAGE,
  AREAS_PER_RESTAURANT_MAX,
  areaNameTakenMessage,
} from './table-area-rules.js';
import type { TableArea } from './table-area.entity.js';
import { TableAreasService } from './table-areas.service.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const TERRACE_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

function area(overrides: Partial<TableArea> = {}): TableArea {
  return {
    id: TERRACE_ID,
    restaurantId: RESTAURANT_ID,
    name: 'Terraza',
    createdAt: new Date('2026-11-10T12:00:00Z'),
    updatedAt: new Date('2026-11-10T12:00:00Z'),
    ...overrides,
  };
}

describe('TableAreasService', () => {
  let rows: TableArea[];
  let repository: {
    find: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let service: TableAreasService;

  beforeEach(() => {
    rows = [area()];
    repository = {
      find: vi.fn(() => Promise.resolve(rows)),
      create: vi.fn((values: Partial<TableArea>) => values),
      save: vi.fn((values: Partial<TableArea>) =>
        Promise.resolve(area({ ...values, id: 'new' })),
      ),
      update: vi.fn(() => Promise.resolve({ affected: 1 })),
    };
    service = new TableAreasService(
      repository as unknown as Repository<TableArea>,
    );
  });

  it('lists the zones of the restaurant in creation order', async () => {
    await service.findAll(RESTAURANT_ID);

    expect(repository.find).toHaveBeenCalledWith({
      where: { restaurantId: RESTAURANT_ID },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('creates a zone with the name trimmed', async () => {
    await service.create(RESTAURANT_ID, '  Piso 2 ');

    expect(repository.save).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      name: 'Piso 2',
    });
  });

  it('rejects a repeated name without caring about case or spaces', async () => {
    await expect(service.create(RESTAURANT_ID, ' TERRAZA')).rejects.toThrow(
      new ConflictException(areaNameTakenMessage('TERRAZA')),
    );
  });

  it('answers the same 409 when the unique index catches a race', async () => {
    repository.save.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_table_areas_restaurant_id_name',
    });

    await expect(service.create(RESTAURANT_ID, 'Bar')).rejects.toThrow(
      new ConflictException(areaNameTakenMessage('Bar')),
    );
  });

  it(`stops at ${AREAS_PER_RESTAURANT_MAX} zones`, async () => {
    rows = Array.from({ length: AREAS_PER_RESTAURANT_MAX }, (_, index) =>
      area({ id: `id-${index}`, name: `Zona ${index}` }),
    );

    await expect(service.create(RESTAURANT_ID, 'Una más')).rejects.toThrow(
      new ConflictException(AREAS_LIMIT_MESSAGE),
    );
  });

  it('renames a zone, even to its own name with other capitals', async () => {
    const renamed = await service.rename(RESTAURANT_ID, TERRACE_ID, 'TERRAZA');

    expect(renamed.name).toBe('TERRAZA');
    expect(repository.update).toHaveBeenCalledWith(
      { id: TERRACE_ID, restaurantId: RESTAURANT_ID },
      { name: 'TERRAZA' },
    );
  });

  it('answers 404 when renaming a zone that is not of the restaurant', async () => {
    await expect(
      service.rename(RESTAURANT_ID, 'another-id', 'Bar'),
    ).rejects.toThrow(new NotFoundException(AREA_NOT_FOUND_MESSAGE));
  });
});
