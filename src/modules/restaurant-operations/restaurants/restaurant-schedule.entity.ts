import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Restaurant } from './restaurant.entity.js';

// One row per open day; a closed day has no row.
@Entity({ name: 'restaurant_schedules' })
@Unique('UQ_restaurant_schedules_restaurant_id_day_of_week', [
  'restaurantId',
  'dayOfWeek',
])
@Check('CHK_restaurant_schedules_day_of_week', '"day_of_week" BETWEEN 1 AND 7')
// Open 24 hours has no times; otherwise both times are required and must
// differ. closes_at < opens_at is valid: it closes the next day.
@Check(
  'CHK_restaurant_schedules_hours',
  `("is_open_24h" = true AND "opens_at" IS NULL AND "closes_at" IS NULL) OR ("is_open_24h" = false AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL AND "opens_at" <> "closes_at")`,
)
export class RestaurantSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  @ForeignKey(() => Restaurant)
  restaurantId: string;

  // ISO 8601: 1 = Monday ... 7 = Sunday.
  @Column({ name: 'day_of_week', type: 'smallint' })
  dayOfWeek: number;

  @Column({ name: 'is_open_24h', type: 'boolean', default: false })
  isOpen24h: boolean;

  // Postgres time without time zone; the pg driver returns it as 'HH:MM:SS'.
  @Column({ name: 'opens_at', type: 'time', nullable: true })
  opensAt: string | null;

  @Column({ name: 'closes_at', type: 'time', nullable: true })
  closesAt: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
