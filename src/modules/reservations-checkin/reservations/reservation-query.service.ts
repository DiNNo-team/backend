import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import { Clock } from '../../search-availability/index.js';
import type { ActiveReservationResponseDto } from './dto/active-reservation-response.dto.js';
import type { ReservationResponseDto } from './dto/reservation-response.dto.js';
import { ReservationExpirationService } from './reservation-expiration.service.js';
import { reservationNotFound } from './reservation-errors.js';
import { Reservation } from './reservation.entity.js';
import { ReservationViewReader } from './reservation-view.reader.js';

// Lectura de las reservas del comensal (§12.8). Antes de devolver una reserva
// activa aplica el vencimiento al leer (§12.5): nunca se devuelve como activa
// una reserva cuyo expires_at ya pasó, aunque el proceso periódico no haya
// pasado todavía.
@Injectable()
export class ReservationQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly expiration: ReservationExpirationService,
    private readonly view: ReservationViewReader,
    private readonly clock: Clock,
  ) {}

  // La reserva activa del comensal, o null (200, nunca 404). serverTime es el
  // mismo dentro y fuera de la reserva.
  async findActive(
    user: CurrentUserData,
  ): Promise<ActiveReservationResponseDto> {
    await this.expiration.expireDueForDiner(user.userId);
    const reservation = await this.reservations().findOne({
      where: { dinerId: user.userId, status: 'active' },
    });
    const serverTime = this.clock.now();
    return {
      reservation: reservation
        ? await this.view.toResponse(reservation, serverTime)
        : null,
      serverTime: serverTime.toISOString(),
    };
  }

  // Una reserva del comensal en cualquier estado. Si no existe o es de otro
  // comensal: el mismo 404 (la consulta filtra por el comensal de la sesión).
  async findOne(
    user: CurrentUserData,
    id: string,
  ): Promise<ReservationResponseDto> {
    let reservation = await this.findOwn(user.userId, id);
    if (reservation.status === 'active') {
      // Si ya pasó su expires_at se vence ahora; se vuelve a leer porque pudo
      // cambiar aquí o en otra operación simultánea.
      await this.expiration.expireIfDue(id);
      reservation = await this.findOwn(user.userId, id);
    }
    return this.view.toResponse(reservation, this.clock.now());
  }

  private async findOwn(dinerId: string, id: string): Promise<Reservation> {
    const reservation = await this.reservations().findOne({
      where: { id, dinerId },
    });
    if (!reservation) {
      throw reservationNotFound();
    }
    return reservation;
  }

  private reservations() {
    return this.dataSource.getRepository(Reservation);
  }
}
