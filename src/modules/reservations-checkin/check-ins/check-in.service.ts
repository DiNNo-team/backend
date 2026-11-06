import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import {
  TableStatusLog,
  requireRestaurant,
} from '../../restaurant-operations/index.js';
import { Clock } from '../../search-availability/index.js';
import { moveReservedTable } from '../reservations/release-reserved-table.js';
import { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import { Reservation } from '../reservations/reservation.entity.js';
import { CheckIn } from './check-in.entity.js';
import { normalizeCheckInCode } from './check-in-code.js';
import {
  reservationAlreadyUsed,
  reservationCancelled,
  reservationCodeNotFound,
  reservationExpired,
} from './check-in-errors.js';
import type { CheckInResponseDto } from './dto/check-in-response.dto.js';
import { ReservationLabelsReader } from './reservation-labels.reader.js';

// Fila que devuelve el UPDATE ... RETURNING: columnas de la base.
interface CompletedRow {
  id: string;
  table_id: string;
}

// El error de una reserva que ya no se puede cumplir, según su estado real
// (§12.6). Una activa aquí es un estado imposible: va al filtro global como 500.
function rejectionFor(reservation: Reservation): Error {
  if (reservation.status === 'expired') {
    return reservationExpired(reservation.expiresAt);
  }
  if (reservation.status === 'cancelled') {
    return reservationCancelled();
  }
  if (reservation.status === 'completed' && reservation.checkedInAt) {
    return reservationAlreadyUsed(reservation.checkedInAt);
  }
  return new Error(
    `La reserva ${reservation.id} no se pudo cumplir y su estado no lo explica.`,
  );
}

// Check-in del restaurante con el código del comensal (§12.3, §12.6). Es el
// evento facturable: reserva, mesa, bitácora y check_ins cambian juntos o ninguno.
//
// No emite RESTAURANT_AVAILABILITY_AFFECTED: reserved → occupied no cambia las
// mesas libres ni las activas, así que availability.changed llevaría el mismo
// valor. El restaurante se entera por table.status_changed (tarea 8).
@Injectable()
export class CheckInService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly expiration: ReservationExpirationService,
    private readonly statusLog: TableStatusLog,
    private readonly labels: ReservationLabelsReader,
    private readonly clock: Clock,
  ) {}

  async checkIn(
    user: CurrentUserData,
    rawCode: string,
  ): Promise<CheckInResponseDto> {
    const restaurantId = requireRestaurant(user.restaurantId);
    const code = normalizeCheckInCode(rawCode);
    if (!code) {
      throw reservationCodeNotFound();
    }
    // Primero la búsqueda dentro del restaurante: un código ajeno es el mismo 404
    // y por eso nunca se vence la reserva de otro restaurante.
    const reservation = await this.findLatest(restaurantId, code);
    if (!reservation) {
      throw reservationCodeNotFound();
    }
    if (reservation.status !== 'active') {
      throw rejectionFor(reservation);
    }
    if (reservation.expiresAt <= this.clock.now()) {
      throw await this.whyNotCheckedIn(reservation.id);
    }

    // Antes de la transacción: una lectura que falle después del commit daría un
    // 500 con el check-in ya hecho.
    const labelOf = await this.labels.read([reservation]);
    const { tableIdentifier, dinerName } = labelOf(reservation);

    const checkedInAt = await this.checkInTransaction(reservation, user.userId);
    if (!checkedInAt) {
      throw await this.whyNotCheckedIn(reservation.id);
    }
    return {
      reservationId: reservation.id,
      tableIdentifier,
      partySize: reservation.partySize,
      dinerName,
      checkedInAt: checkedInAt.toISOString(),
    };
  }

  // El código solo es único entre las activas: puede repetirse en reservas viejas
  // del restaurante. Una activa siempre es la más reciente de su código, porque
  // mientras exista ninguna otra puede tomarlo.
  private findLatest(
    restaurantId: string,
    code: string,
  ): Promise<Reservation | null> {
    return this.dataSource.getRepository(Reservation).findOne({
      where: { restaurantId, code },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  // Todo o nada. null si el UPDATE no encontró la reserva activa y vigente (otra
  // operación se adelantó, o venció entre medias).
  private checkInTransaction(
    reservation: Reservation,
    adminId: string,
  ): Promise<Date | null> {
    const now = this.clock.now();
    return this.dataSource.transaction(async (manager) => {
      const [row] = await this.markCompleted(manager, reservation, now);
      if (!row) {
        return null;
      }
      await moveReservedTable(manager, this.statusLog, {
        tableId: row.table_id,
        to: 'occupied',
        userId: adminId,
        source: 'reservation',
        changedAt: now,
      });
      await manager.getRepository(CheckIn).insert({
        reservationId: reservation.id,
        restaurantId: reservation.restaurantId,
        checkedInAt: now,
      });
      return now;
    });
  }

  // La condición va en el UPDATE: dos check-ins, o un check-in contra una
  // cancelación o un vencimiento, no se pisan; el que llega segundo espera el
  // bloqueo de la fila, ya no la ve activa y devuelve cero filas. Bloquea primero
  // la reserva y después la mesa, igual que vencer y cancelar.
  private async markCompleted(
    manager: EntityManager,
    reservation: Reservation,
    now: Date,
  ): Promise<CompletedRow[]> {
    // RETURNING como texto, no como arreglo (ver ReservationCancellationService).
    const result = await manager
      .createQueryBuilder()
      .update(Reservation)
      .set({ status: 'completed', checkedInAt: now })
      .where(
        `"id" = :id AND "restaurant_id" = :restaurantId AND "status" = 'active' AND "expires_at" > :now`,
        {
          id: reservation.id,
          restaurantId: reservation.restaurantId,
          now,
        },
      )
      .returning('"id", "table_id"')
      .execute();
    return result.raw as CompletedRow[];
  }

  // Vencimiento al operar (§12.5), fuera de cualquier transacción: vence la
  // reserva si le tocaba y responde según su estado real, que pudo dejarlo otra
  // operación que se adelantó. Se llama solo con una reserva ya encontrada dentro
  // del restaurante.
  private async whyNotCheckedIn(id: string): Promise<Error> {
    await this.expiration.expireIfDue(id);
    const current = await this.dataSource
      .getRepository(Reservation)
      .findOneOrFail({ where: { id } });
    return rejectionFor(current);
  }
}
