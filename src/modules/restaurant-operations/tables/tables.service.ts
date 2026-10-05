import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { CreateTableDto } from './dto/create-table.dto.js';
import { Table } from './table.entity.js';

const UNIQUE_VIOLATION = '23505';
const UNIQUE_IDENTIFIER_INDEX = 'UQ_tables_restaurant_id_identifier';

export const RESTAURANT_REQUIRED_MESSAGE =
  'Primero registra tu restaurante para poder usar tus mesas.';
export const RESTAURANT_REQUIRED_CODE = 'RESTAURANT_REQUIRED';

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(Table) private readonly tables: Repository<Table>,
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
