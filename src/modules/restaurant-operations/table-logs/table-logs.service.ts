import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { requireRestaurant } from '../shared/restaurant-required.js';
import { Table } from '../tables/table.entity.js';
import type { TableLogStatus } from '../tables/table-status-log.js';
import { TableLog } from './table-log.entity.js';

// Rows of the table log screen. No pagination in Sprint 1.
export const TABLE_LOGS_LIMIT = 200;

export interface TableLogRow {
  id: string;
  tableId: string;
  tableIdentifier: string;
  previousStatus: TableLogStatus;
  newStatus: TableLogStatus;
  changedAt: Date;
  userEmail: string;
}

// Read side of the table log (PBI 9). Writing stays in DbTableStatusLog.
@Injectable()
export class TableLogsService {
  constructor(
    @InjectRepository(TableLog)
    private readonly logs: Repository<TableLog>,
  ) {}

  // Newest first. table_logs has no restaurant_id: the restaurant filter goes
  // through the join to tables, always with the session restaurant (agreed
  // with Elizabeth). A tableId of another restaurant just matches no rows.
  async findForRestaurant(
    restaurantId: string | null,
    tableId?: string,
  ): Promise<TableLogRow[]> {
    const ownerId = requireRestaurant(restaurantId);
    const query = this.logs
      .createQueryBuilder('log')
      .innerJoin(Table, 'loggedTable', 'loggedTable.id = log.tableId')
      // By entity name: identity-access does not export its entity class.
      .innerJoin('User', 'author', 'author.id = log.userId')
      .select('log.id', 'id')
      .addSelect('log.tableId', 'tableId')
      .addSelect('loggedTable.identifier', 'tableIdentifier')
      .addSelect('log.previousStatus', 'previousStatus')
      .addSelect('log.newStatus', 'newStatus')
      .addSelect('log.changedAt', 'changedAt')
      .addSelect('author.email', 'userEmail')
      .where('loggedTable.restaurantId = :restaurantId', {
        restaurantId: ownerId,
      });
    if (tableId !== undefined) {
      query.andWhere('log.tableId = :tableId', { tableId });
    }
    // id breaks ties so the order is stable between requests.
    return query
      .orderBy('log.changedAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .limit(TABLE_LOGS_LIMIT)
      .getRawMany<TableLogRow>();
  }
}
