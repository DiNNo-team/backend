import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import type { CreateTableDto } from './dto/create-table.dto.js';
import { Table, type TableStatus } from './table.entity.js';
import { TableStatusLog } from './table-status-log.js';

const UNIQUE_VIOLATION = '23505';
const UNIQUE_IDENTIFIER_INDEX = 'UQ_tables_restaurant_id_identifier';

export const RESTAURANT_REQUIRED_MESSAGE =
  'Primero registra tu restaurante para poder usar tus mesas.';
export const RESTAURANT_REQUIRED_CODE = 'RESTAURANT_REQUIRED';
// Same text for a missing table and another restaurant's table: never reveal
// that a table of another restaurant exists.
export const TABLE_NOT_FOUND_MESSAGE =
  'No encontramos esta mesa. Actualiza la lista de mesas e intenta de nuevo.';
export const TABLE_INACTIVE_MESSAGE =
  'Esta mesa está inactiva. Reactívala para cambiar su estado.';

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
    const ownerId = this.requireRestaurant(restaurantId);
    const identifier = dto.identifier.trim();
    // Explicit fields: nothing else from the request reaches the entity.
    const table = this.tables.create({
      restaurantId: ownerId,
      identifier,
      capacity: dto.capacity,
      status: 'available',
      isActive: true,
    });

    try {
      return await this.tables.save(table);
    } catch (error) {
      if (isDuplicateIdentifier(error)) {
        throw new ConflictException(
          'Ya tienes una mesa con ese nombre. Usa uno diferente.',
        );
      }
      throw error;
    }
  }

  async findAll(restaurantId: string | null): Promise<Table[]> {
    const ownerId = this.requireRestaurant(restaurantId);
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
    const ownerId = this.requireRestaurant(user.restaurantId);

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

  private requireRestaurant(restaurantId: string | null): string {
    if (!restaurantId) {
      // errorCode lets the front tell this 403 apart and send the user to sign-up.
      throw new ForbiddenException(RESTAURANT_REQUIRED_MESSAGE, {
        errorCode: RESTAURANT_REQUIRED_CODE,
      });
    }
    return restaurantId;
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
