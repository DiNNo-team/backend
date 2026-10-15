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
import { USER_ROLES, UserRole } from '../roles/user-role.js';

const ROLE_VALUES_SQL = USER_ROLES.map((role) => `'${role}'`).join(', ');

@Entity({ name: 'users' })
@Unique('UQ_users_email', ['email'])
@Unique('UQ_users_firebase_uid', ['firebaseUid'])
// TypeORM compares checks by name only: changing UserRole needs a
// hand-written migration that drops and recreates CHK_users_role.
@Check('CHK_users_role', `"role" IN (${ROLE_VALUES_SQL})`)
// UsersService normalizes before writing and looking up; this keeps rows
// written by hand (docs/database.md) findable too.
@Check('CHK_users_email_normalized', `"email" = lower(trim("email"))`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({
    name: 'firebase_uid',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  firebaseUid: string | null;

  // Name shown in the app (diners). null for restaurant accounts.
  @Column({ name: 'display_name', type: 'varchar', length: 60, nullable: true })
  displayName: string | null;

  // Guaranteed by CHK_users_role.
  @Column({ type: 'varchar', length: 50 })
  role: UserRole;

  // String target: restaurant-operations does not export its entity class.
  @Column({ name: 'restaurant_id', type: 'uuid', nullable: true })
  @ForeignKey('Restaurant')
  restaurantId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
