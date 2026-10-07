import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  TableStatusLog,
  type TableStatusChange,
} from '../tables/table-status-log.js';
import { TableLog } from './table-log.entity.js';

// Real TableStatusLog (PBI 9): one table_logs row per status change, written
// through the caller's transaction manager. No injected repository on purpose:
// writing outside `manager` could leave a change without its row, or the other
// way around. Errors are not caught, so a failed insert rolls back the change.
@Injectable()
export class DbTableStatusLog extends TableStatusLog {
  async record(
    change: TableStatusChange,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(TableLog).insert({
      tableId: change.tableId,
      previousStatus: change.previousStatus,
      newStatus: change.newStatus,
      userId: change.userId,
      changedAt: change.changedAt,
    });
  }
}
