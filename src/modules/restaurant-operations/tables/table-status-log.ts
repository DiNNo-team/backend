import type { EntityManager } from 'typeorm';

// What the log stores as a table's status: its operational status, or
// 'inactive' for a deactivated table. Deactivating logs <status> → 'inactive';
// reactivating logs 'inactive' → 'available' (PBI 7 and PBI 9). 'inactive' is
// never a value of tables.status: it only exists in the log.
export const TABLE_LOG_STATUSES = [
  'available',
  'reserved',
  'occupied',
  'inactive',
] as const;
export type TableLogStatus = (typeof TABLE_LOG_STATUSES)[number];

// One table status change, as agreed with the table log owner (Sergio).
export interface TableStatusChange {
  tableId: string;
  previousStatus: TableLogStatus;
  newStatus: TableLogStatus;
  // The session user who made the change.
  userId: string;
  changedAt: Date;
}

// Port owned by tables/: the table log (table-logs/) implements it, so tables/
// never depends on table-logs/. The real implementation is DbTableStatusLog
// (table-logs/table-logs.recorder.ts), wired by the useClass line in the module.
export abstract class TableStatusLog {
  // Must write through `manager`: it is the status change transaction, so if
  // this throws, the status change is rolled back too.
  abstract record(
    change: TableStatusChange,
    manager: EntityManager,
  ): Promise<void>;
}
