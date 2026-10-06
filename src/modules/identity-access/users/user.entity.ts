import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
@Unique('UQ_users_email', ['email'])
@Unique('UQ_users_firebase_uid', ['firebaseUid'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'firebase_uid', type: 'varchar', length: 128, nullable: true })
  firebaseUid: string | null;

  @Column({ type: 'varchar', length: 50 })
  role: string;

  // String target: restaurant-operations does not export its entity class.
  @Column({ name: 'restaurant_id', type: 'uuid', nullable: true })
  @ForeignKey('Restaurant')
  restaurantId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
