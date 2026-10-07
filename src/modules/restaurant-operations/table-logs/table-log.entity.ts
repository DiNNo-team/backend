import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Table } from '../tables/table.entity.js';
import {
  TABLE_LOG_STATUSES,
  type TableLogStatus,
} from '../tables/table-status-log.js';

// Built from TABLE_LOG_STATUSES, not copied from tables.status: the log also
// stores 'inactive' (deactivate and reactivate). TypeORM compares checks by
// name only, so changing the list needs a hand-written migration.
const LOG_STATUS_VALUES_SQL = TABLE_LOG_STATUSES.map(
  (status) => `'${status}'`,
).join(', ');

// One table status change (PBI 9). Rows are only inserted, never updated:
// written by DbTableStatusLog inside the transaction that changes the table.
@Entity({ name: 'table_logs' })
@Index('IDX_table_logs_table_id_changed_at', ['tableId', 'changedAt'])
@Check(
  'CHK_table_logs_previous_status',
  `"previous_status" IN (${LOG_STATUS_VALUES_SQL})`,
)
@Check(
  'CHK_table_logs_new_status',
  `"new_status" IN (${LOG_STATUS_VALUES_SQL})`,
)
export class TableLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'table_id', type: 'uuid' })
  @ForeignKey(() => Table)
  tableId: string;

  @Column({ name: 'previous_status', type: 'varchar', length: 20 })
  previousStatus: TableLogStatus;

  @Column({ name: 'new_status', type: 'varchar', length: 20 })
  newStatus: TableLogStatus;

  // String target: identity-access does not export its entity class.
  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User')
  userId: string;

  // When the change happened (set by the service that changes the table);
  // created_at is when the row was written. Both are the same transaction.
  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
