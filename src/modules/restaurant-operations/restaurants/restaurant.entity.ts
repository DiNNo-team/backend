import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const RESTAURANT_CATEGORIES = [
  'colombian',
  'italian',
  'mexican',
  'asian',
  'grill',
  'fast_food',
  'healthy',
  'seafood',
  'cafe',
  'other',
] as const;
export type RestaurantCategory = (typeof RESTAURANT_CATEGORIES)[number];

const CATEGORY_VALUES_SQL = RESTAURANT_CATEGORIES.map(
  (category) => `'${category}'`,
).join(', ');

@Entity({ name: 'restaurants' })
// TypeORM compares checks by name only: changing RESTAURANT_CATEGORIES needs a
// hand-written migration that drops and recreates this check.
@Check(
  'CHK_restaurants_category',
  `"category" IS NULL OR "category" IN (${CATEGORY_VALUES_SQL})`,
)
export class Restaurant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // Nullable in the database because restaurants created before PBI 3 have
  // none; the registration endpoint makes it required.
  @Column({ type: 'varchar', length: 50, nullable: true })
  category: RestaurantCategory | null;

  // Nullable for the same reason as category.
  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
