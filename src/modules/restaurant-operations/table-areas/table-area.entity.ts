import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Restaurant } from '../restaurants/restaurant.entity.js';

// A zone of the restaurant where tables live ("Piso 1", "Terraza", "Bar"),
// to organize big restaurants: each zone has its own floor plan and the web
// filters the tables by zone. The name is free and unique per restaurant.
@Entity({ name: 'table_areas' })
// Unique on (restaurant_id, lower(trim(name))). TypeORM cannot express index
// expressions, so it is written by hand in the CreateTableAreas migration.
@Index('UQ_table_areas_restaurant_id_name', { synchronize: false })
export class TableArea {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_table_areas_id',
  })
  id: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  @ForeignKey(() => Restaurant, {
    name: 'FK_table_areas_restaurant_id',
    onDelete: 'CASCADE',
  })
  restaurantId: string;

  @Column({ type: 'varchar', length: 30 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
