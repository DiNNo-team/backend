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

export const PUSH_PLATFORMS = ['android', 'ios'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

// Longest FCM registration token we accept (they are ~160–200 characters today).
export const PUSH_TOKEN_MAX_LENGTH = 4096;

// A phone of a diner that receives the reservation notifications (Sprint 4,
// PBI 1.1): the FCM registration token the app got from the system. A token
// belongs to one phone and one account at a time: signing in with another
// account on the same phone moves the row to that account.
@Entity({ name: 'push_devices' })
@Check('CHK_push_devices_platform', `"platform" IN ('android', 'ios')`)
@Index('IDX_push_devices_user_id', ['userId'])
export class PushDevice {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_push_devices_id',
  })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey('User', { name: 'FK_push_devices_user_id', onDelete: 'CASCADE' })
  userId: string;

  @Column({ type: 'varchar', length: PUSH_TOKEN_MAX_LENGTH })
  @Index('UQ_push_devices_token', { unique: true })
  token: string;

  @Column({ type: 'varchar', length: 10 })
  platform: PushPlatform;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
