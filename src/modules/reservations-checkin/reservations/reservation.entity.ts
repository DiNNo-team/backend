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
import {
  RESERVATION_CODE_ALPHABET,
  RESERVATION_CODE_LENGTH,
  RESERVATION_MAX_PARTY_SIZE,
  RESERVATION_MIN_PARTY_SIZE,
  RESERVATION_STATUSES,
  type ReservationStatus,
} from './reservation.constants.js';

const STATUS_VALUES_SQL = RESERVATION_STATUSES.map(
  (status) => `'${status}'`,
).join(', ');

// Los índices únicos parciales son la defensa final contra la concurrencia
// (§12.4): una reserva activa por mesa, por comensal y por código.
const ONLY_ACTIVE = `"status" = 'active'`;

// Microreserva (§12). Los checks y los índices parciales los escribe a mano la
// migración CreateReservations; TypeORM compara checks solo por nombre, así que
// cambiar una lista exige una migración escrita a mano.
@Entity({ name: 'reservations' })
@Check('CHK_reservations_status', `"status" IN (${STATUS_VALUES_SQL})`)
@Check(
  'CHK_reservations_party_size',
  `"party_size" BETWEEN ${RESERVATION_MIN_PARTY_SIZE} AND ${RESERVATION_MAX_PARTY_SIZE}`,
)
@Check(
  'CHK_reservations_code',
  `"code" ~ '^[${RESERVATION_CODE_ALPHABET}]{${RESERVATION_CODE_LENGTH}}$'`,
)
@Index('UQ_reservations_active_table', ['tableId'], {
  unique: true,
  where: ONLY_ACTIVE,
})
@Index('UQ_reservations_active_diner', ['dinerId'], {
  unique: true,
  where: ONLY_ACTIVE,
})
@Index('UQ_reservations_active_code', ['code'], {
  unique: true,
  where: ONLY_ACTIVE,
})
// Lista del restaurante y proceso de vencimiento.
@Index('IDX_reservations_restaurant_status_expires_at', [
  'restaurantId',
  'status',
  'expiresAt',
])
// Historial del comensal, de lo más reciente a lo más antiguo.
@Index('IDX_reservations_diner_id_created_at', ['dinerId', 'createdAt'])
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: RESERVATION_CODE_LENGTH })
  code: string;

  @Column({ type: 'varchar', length: 20 })
  status: ReservationStatus;

  @Column({ name: 'party_size', type: 'smallint' })
  partySize: number;

  // Destinos por nombre: la entidad es de otro módulo (CLAUDE.md §11).
  @Column({ name: 'diner_id', type: 'uuid' })
  @ForeignKey('User')
  dinerId: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  @ForeignKey('Restaurant')
  restaurantId: string;

  @Column({ name: 'table_id', type: 'uuid' })
  @ForeignKey('Table')
  tableId: string;

  // Fuente de verdad del vencimiento (§12.5).
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt: Date | null;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt: Date | null;

  // Marca del vencimiento sin llegar, para el Sprint 4 y la IA (§12.5).
  @Column({ name: 'no_show', type: 'boolean', default: false })
  noShow: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
