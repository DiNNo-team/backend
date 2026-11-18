import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Reservation } from '../reservations/reservation.entity.js';

// Evento facturable (§12.6): un registro por check-in válido. Es único por
// reserva, así que nunca se cobra dos veces. El estado de cuenta (CLAUDE.md §11,
// "Cobro por check-in") suma fee_cop por rango de checked_in_at.
@Entity({ name: 'check_ins' })
@Unique('UQ_check_ins_reservation_id', ['reservationId'])
@Check('CHK_check_ins_fee_cop', `"fee_cop" >= 0`)
@Index('IDX_check_ins_restaurant_id_checked_in_at', [
  'restaurantId',
  'checkedInAt',
])
// Cobro de toda la plataforma (panel del administrador): solo por fecha
// (1794700000002-AddPlatformReportIndexes).
@Index('IDX_check_ins_checked_in_at', ['checkedInAt'])
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

  // Tarifa en COP cobrada por este check-in: CHECKIN_FEE_COP en ese momento
  // (snapshot). Sin default a propósito: el check-in siempre la fija.
  @Column({ name: 'fee_cop', type: 'integer' })
  feeCop: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
