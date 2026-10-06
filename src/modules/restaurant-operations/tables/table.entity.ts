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

export const TABLE_STATUSES = ['available', 'reserved', 'occupied'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

@Entity({ name: 'tables' })
// Unique on (restaurant_id, lower(trim(identifier))). TypeORM cannot express
// index expressions, so it is written by hand in the CreateInitialTables migration.
@Index('UQ_tables_restaurant_id_identifier', { synchronize: false })
@Check('CHK_tables_capacity', '"capacity" BETWEEN 1 AND 20')
@Check('CHK_tables_status', `"status" IN ('available', 'reserved', 'occupied')`)
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
