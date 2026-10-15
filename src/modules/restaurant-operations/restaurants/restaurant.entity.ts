import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';

// pg returns numeric as a string (it may not fit a JS number); the
// coordinates, numeric(9,6), always fit, so the entity speaks number | null.
export const coordinateTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

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
// Both coordinates or neither. The Bogotá bounds are checked by the API.
@Check(
  'CHK_restaurants_location_pair',
  `("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)`,
)
@Check('CHK_restaurants_latitude', `"latitude" BETWEEN -90 AND 90`)
@Check('CHK_restaurants_longitude', `"longitude" BETWEEN -180 AND 180`)
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

  // Open/closed switch of the restaurant (PBI 8), changed by hand from the
  // dashboard. It does not follow restaurant_schedules in Sprint 1.
  @Column({ name: 'is_open', type: 'boolean', default: true })
  isOpen: boolean;

  // Location for the diner search (Sprint 2). Nullable: restaurants
  // registered before Sprint 2 have none, and without coordinates a
  // restaurant does not appear in the search.
  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinateTransformer,
  })
  latitude: number | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: coordinateTransformer,
  })
  longitude: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
