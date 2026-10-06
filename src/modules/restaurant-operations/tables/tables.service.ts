import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import { requireRestaurant } from '../shared/restaurant-required.js';
import type { CreateTableDto } from './dto/create-table.dto.js';
import type { UpdateTableDto } from './dto/update-table.dto.js';
import {
  identifierTakenMessage,
  normalizeTableIdentifier,
} from './table-identifier.js';
import { Table, type TableStatus } from './table.entity.js';
import { TableStatusLog } from './table-status-log.js';

const UNIQUE_VIOLATION = '23505';
const UNIQUE_IDENTIFIER_INDEX = 'UQ_tables_restaurant_id_identifier';

// Same text for a missing table and another restaurant's table: never reveal
// that a table of another restaurant exists.
export const TABLE_NOT_FOUND_MESSAGE =
  'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.';
export const TABLE_INACTIVE_MESSAGE =
  'Esta mesa está inactiva. Reactívala para cambiar su estado.';
export const TABLE_ALREADY_INACTIVE_MESSAGE =
  'Esta mesa ya está inactiva. Actualiza la lista de mesas.';
export const TABLE_ALREADY_ACTIVE_MESSAGE =
  'Esta mesa ya está activa. Actualiza la lista de mesas.';
export const NO_TABLE_CHANGES_MESSAGE =
  'No hay cambios para guardar. Cambia el identificador o la capacidad de la mesa.';

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(Table) private readonly tables: Repository<Table>,
    private readonly statusLog: TableStatusLog,
  ) {}

  async create(
    restaurantId: string | null,
    dto: CreateTableDto,
  ): Promise<Table> {
    const ownerId = requireRestaurant(restaurantId);
    const identifier = dto.identifier.trim();
    await this.assertIdentifierAvailable(ownerId, identifier);
    // Explicit fields: nothing else from the request reaches the entity.
    const table = this.tables.create({
      restaurantId: ownerId,
      identifier,
      capacity: dto.capacity,
      status: 'available',
      isActive: true,
    });

    return this.saveIdentifier(table);
  }

  async findAll(restaurantId: string | null): Promise<Table[]> {
    const ownerId = requireRestaurant(restaurantId);
    // created_at, not identifier: by text "Mesa 10" would sort before "Mesa 2".
    // id breaks ties so rows created in the same instant keep a stable order.
    return this.tables.find({
      where: { restaurantId: ownerId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  // Status change and log entry share one transaction: if the log fails, the
  // status change is rolled back.
  async updateStatus(
    user: CurrentUserData,
    tableId: string,
    status: TableStatus,
  ): Promise<Table> {
    const ownerId = requireRestaurant(user.restaurantId);

    return this.tables.manager.transaction(async (manager) => {
      // Row lock: concurrent changes to the same table queue up, so each log
      // entry gets the real previous status.
      const table = await manager.findOne(Table, {
        where: { id: tableId, restaurantId: ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) {
        throw new NotFoundException(TABLE_NOT_FOUND_MESSAGE);
      }
      if (!table.isActive) {
        throw new ConflictException(TABLE_INACTIVE_MESSAGE);
      }
      // Same status is a valid no-op (the web's "Deshacer" relies on it):
      // nothing changed, so nothing is written or logged.
      if (table.status === status) {
        return table;
      }

      const previousStatus = table.status;
      table.status = status;
      const saved = await manager.save(table);
      await this.statusLog.record(
        {
          tableId: saved.id,
          previousStatus,
          newStatus: status,
          userId: user.userId,
          changedAt: new Date(),
        },
        manager,
      );
      return saved;
    });
  }

  // Edit (PBI 7): identifier and/or capacity. Works on inactive tables too and
  // never changes the status, so nothing goes to the log.
  async update(
    restaurantId: string | null,
    tableId: string,
    dto: UpdateTableDto,
  ): Promise<Table> {
    const ownerId = requireRestaurant(restaurantId);
    const identifier = dto.identifier?.trim();
    if (identifier === undefined && dto.capacity === undefined) {
      // A list, like the other validation 400s.
      throw new BadRequestException([NO_TABLE_CHANGES_MESSAGE]);
    }

    const table = await this.tables.findOneBy({
      id: tableId,
      restaurantId: ownerId,
    });
    if (!table) {
      throw new NotFoundException(TABLE_NOT_FOUND_MESSAGE);
    }
    if (identifier !== undefined) {
      await this.assertIdentifierAvailable(ownerId, identifier, table.id);
      table.identifier = identifier;
    }
    if (dto.capacity !== undefined) {
      table.capacity = dto.capacity;
    }
    return this.saveIdentifier(table);
  }

  // Deactivate (PBI 7): keeps its status, stops being operational, and logs
  // <status> → inactive in the same transaction.
  async deactivate(user: CurrentUserData, tableId: string): Promise<Table> {
    return this.changeActive(user, tableId, false);
  }

  // Reactivate (PBI 7): back as available, logging inactive → available.
  async reactivate(user: CurrentUserData, tableId: string): Promise<Table> {
    return this.changeActive(user, tableId, true);
  }

  private async changeActive(
    user: CurrentUserData,
    tableId: string,
    active: boolean,
  ): Promise<Table> {
    const ownerId = requireRestaurant(user.restaurantId);

    return this.tables.manager.transaction(async (manager) => {
      // Same row lock as updateStatus: the log always gets the real previous state.
      const table = await manager.findOne(Table, {
        where: { id: tableId, restaurantId: ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) {
        throw new NotFoundException(TABLE_NOT_FOUND_MESSAGE);
      }
      if (table.isActive === active) {
        throw new ConflictException(
          active
            ? TABLE_ALREADY_ACTIVE_MESSAGE
            : TABLE_ALREADY_INACTIVE_MESSAGE,
        );
      }

      const previousStatus = active ? 'inactive' : table.status;
      table.isActive = active;
      if (active) {
        table.status = 'available';
      }
      const saved = await manager.save(table);
      await this.statusLog.record(
        {
          tableId: saved.id,
          previousStatus,
          newStatus: active ? 'available' : 'inactive',
          userId: user.userId,
          changedAt: new Date(),
        },
        manager,
      );
      return saved;
    });
  }

  // "4", "04" and "Mesa 4" are the same table (table-identifier.ts). The unique
  // index only catches exact repeats (lower(trim)), so this check runs first;
  // the index still guards the race of two identical requests at once.
  private async assertIdentifierAvailable(
    restaurantId: string,
    identifier: string,
    ignoreId?: string,
  ): Promise<void> {
    const key = normalizeTableIdentifier(identifier);
    const existing = await this.tables.find({
      where: { restaurantId },
      select: { id: true, identifier: true },
    });
    const taken = existing.some(
      (table) =>
        table.id !== ignoreId &&
        normalizeTableIdentifier(table.identifier) === key,
    );
    if (taken) {
      throw new ConflictException(identifierTakenMessage(identifier));
    }
  }

  // Saves a table whose identifier may have changed (create and edit).
  private async saveIdentifier(table: Table): Promise<Table> {
    try {
      return await this.tables.save(table);
    } catch (error) {
      if (isDuplicateIdentifier(error)) {
        throw new ConflictException(identifierTakenMessage(table.identifier));
      }
      throw error;
    }
  }
}

function isDuplicateIdentifier(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
  };
  return (
    driverError.code === UNIQUE_VIOLATION &&
    driverError.constraint === UNIQUE_IDENTIFIER_INDEX
  );
}
