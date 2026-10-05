import type { EntityManager } from 'typeorm';
import type { TableStatus } from './table.entity.js';

// One table status change, as agreed with the table log owner (Sergio).
export interface TableStatusChange {
  tableId: string;
  previousStatus: TableStatus;
  newStatus: TableStatus;
  // The session user who made the change.
  userId: string;
  changedAt: Date;
}

// Port owned by tables/: the table log (table-logs/) implements it, so tables/
// never depends on table-logs/. Swap point: today NoopTableStatusLog, later the
// real implementation, changing only the useClass line in the module.
export abstract class TableStatusLog {
  // Must write through `manager`: it is the status change transaction, so if
  // this throws, the status change is rolled back too.
  abstract record(
    change: TableStatusChange,
    manager: EntityManager,
  ): Promise<void>;
}
