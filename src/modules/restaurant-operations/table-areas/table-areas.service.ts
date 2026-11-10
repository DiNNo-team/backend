import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../../common/database/unique-violation.js';
import { requireRestaurant } from '../shared/restaurant-required.js';
import { Table } from '../tables/table.entity.js';
import {
  AREA_NOT_FOUND_MESSAGE,
  AREAS_LIMIT_MESSAGE,
  AREAS_PER_RESTAURANT_MAX,
  areaNameTakenMessage,
  normalizeAreaName,
} from './table-area-rules.js';
import { TableArea } from './table-area.entity.js';

const UNIQUE_NAME_INDEX = 'UQ_table_areas_restaurant_id_name';

// Zones never change availability, the status of a table or the log: they
// only organize the tables on the web. No event is emitted.
@Injectable()
export class TableAreasService {
  constructor(
    @InjectRepository(TableArea)
    private readonly areas: Repository<TableArea>,
  ) {}

  async findAll(restaurantId: string | null): Promise<TableArea[]> {
    const ownerId = requireRestaurant(restaurantId);
    // Creation order: "Piso 1" before "Piso 2" if they were created that way,
    // which is how a restaurant usually sets them up.
    return this.areas.find({
      where: { restaurantId: ownerId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async create(restaurantId: string | null, name: string): Promise<TableArea> {
    const ownerId = requireRestaurant(restaurantId);
    const existing = await this.findAll(ownerId);
    if (existing.length >= AREAS_PER_RESTAURANT_MAX) {
      throw new ConflictException(AREAS_LIMIT_MESSAGE);
    }
    this.assertNameAvailable(existing, name);
    const area = this.areas.create({
      restaurantId: ownerId,
      name: name.trim(),
    });
    return this.writeName(() => this.areas.save(area), name);
  }

  async rename(
    restaurantId: string | null,
    areaId: string,
    name: string,
  ): Promise<TableArea> {
    const ownerId = requireRestaurant(restaurantId);
    const existing = await this.findAll(ownerId);
    const area = existing.find((candidate) => candidate.id === areaId);
    if (!area) {
      throw new NotFoundException(AREA_NOT_FOUND_MESSAGE);
    }
    this.assertNameAvailable(existing, name, area.id);
    await this.writeName(
      () =>
        this.areas.update(
          { id: area.id, restaurantId: ownerId },
          { name: name.trim() },
        ),
      name,
    );
    return { ...area, name: name.trim() };
  }

  // The tables of the zone stay, without zone and off the plan: their cells
  // could overlap the tables of the zone they end up sharing a plan with.
  async remove(restaurantId: string | null, areaId: string): Promise<void> {
    const ownerId = requireRestaurant(restaurantId);
    await this.areas.manager.transaction(async (manager) => {
      const area = await manager.findOne(TableArea, {
        where: { id: areaId, restaurantId: ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!area) {
        throw new NotFoundException(AREA_NOT_FOUND_MESSAGE);
      }
      await manager.update(
        Table,
        { restaurantId: ownerId, areaId: area.id },
        { areaId: null, planX: null, planY: null, planShape: null },
      );
      await manager.delete(TableArea, { id: area.id, restaurantId: ownerId });
    });
  }

  private assertNameAvailable(
    existing: TableArea[],
    name: string,
    ignoreId?: string,
  ): void {
    const key = normalizeAreaName(name);
    const taken = existing.some(
      (area) => area.id !== ignoreId && normalizeAreaName(area.name) === key,
    );
    if (taken) {
      throw new ConflictException(areaNameTakenMessage(name));
    }
  }

  // The unique index still guards two identical requests at once.
  private async writeName<T>(
    write: () => Promise<T>,
    name: string,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error, UNIQUE_NAME_INDEX)) {
        throw new ConflictException(areaNameTakenMessage(name));
      }
      throw error;
    }
  }
}
