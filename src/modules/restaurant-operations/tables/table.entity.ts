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
import { Restaurant } from '../restaurants/restaurant.entity.js';
import type { TableShape } from './table-plan.js';

export const TABLE_STATUSES = ['available', 'reserved', 'occupied'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

@Entity({ name: 'tables' })
// Unique on (restaurant_id, lower(trim(identifier))). TypeORM cannot express
// index expressions, so it is written by hand in the CreateInitialTables migration.
@Index('UQ_tables_restaurant_id_identifier', { synchronize: false })
@Check('CHK_tables_capacity', '"capacity" BETWEEN 1 AND 20')
@Check('CHK_tables_status', `"status" IN ('available', 'reserved', 'occupied')`)
// Floor plan (migration AddTablePlan): both cells or none, inside the grid of
// table-plan.ts (PLAN_COLUMNS × PLAN_ROWS), and one of TABLE_SHAPES.
@Check(
  'CHK_tables_plan_pair',
  '("plan_x" IS NULL AND "plan_y" IS NULL) OR ("plan_x" IS NOT NULL AND "plan_y" IS NOT NULL)',
)
@Check('CHK_tables_plan_x', '"plan_x" BETWEEN 0 AND 19')
@Check('CHK_tables_plan_y', '"plan_y" BETWEEN 0 AND 29')
@Check('CHK_tables_plan_shape', `"plan_shape" IN ('square', 'round', 'rect')`)
export class Table {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  @ForeignKey(() => Restaurant)
  restaurantId: string;

  @Column({ type: 'varchar', length: 50 })
  identifier: string;

  @Column({ type: 'smallint' })
  capacity: number;

  @Column({ type: 'varchar', length: 20, default: 'available' })
  status: TableStatus;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Column of the top-left cell on the floor plan; null while the table is not placed. */
  @Column({ name: 'plan_x', type: 'smallint', nullable: true })
  planX: number | null;

  /** Row of the top-left cell on the floor plan; null while the table is not placed. */
  @Column({ name: 'plan_y', type: 'smallint', nullable: true })
  planY: number | null;

  /** Shape chosen on the plan; null = a rectangle sized by the capacity. */
  @Column({ name: 'plan_shape', type: 'varchar', length: 10, nullable: true })
  planShape: TableShape | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
