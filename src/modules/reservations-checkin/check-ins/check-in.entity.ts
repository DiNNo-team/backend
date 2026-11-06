import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Reservation } from '../reservations/reservation.entity.js';

// Evento facturable (§12.6): un registro por check-in válido. Es único por
// reserva, así que nunca se cobra dos veces. El estado de cuenta es del Sprint 4.
@Entity({ name: 'check_ins' })
@Unique('UQ_check_ins_reservation_id', ['reservationId'])
export class CheckIn {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  @ForeignKey(() => Reservation)
  reservationId: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  @ForeignKey('Restaurant')
  restaurantId: string;

  @Column({ name: 'checked_in_at', type: 'timestamptz' })
  checkedInAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
