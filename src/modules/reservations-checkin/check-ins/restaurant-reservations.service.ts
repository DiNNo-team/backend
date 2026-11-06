import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import { requireRestaurant } from '../../restaurant-operations/index.js';
import { Clock } from '../../search-availability/index.js';
import { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import type { ReservationStatus } from '../reservations/reservation.constants.js';
import { Reservation } from '../reservations/reservation.entity.js';
import type { RestaurantReservationResponseDto } from './dto/restaurant-reservation-response.dto.js';
import { ReservationLabelsReader } from './reservation-labels.reader.js';
import { toRestaurantReservation } from './restaurant-reservation.mapper.js';

// Reservas del restaurante de la sesión (§12.8), la más próxima a vencer primero.
// Nunca trae el código (§12.6): la consulta ni siquiera lo pide.
@Injectable()
export class RestaurantReservationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly expiration: ReservationExpirationService,
    private readonly labels: ReservationLabelsReader,
    private readonly clock: Clock,
  ) {}

  async list(
    user: CurrentUserData,
    status: ReservationStatus = 'active',
  ): Promise<RestaurantReservationResponseDto[]> {
    const restaurantId = requireRestaurant(user.restaurantId);
    // Antes de leer: nunca sale como activa una reserva vencida (§12.5).
    await this.expiration.expireDueForRestaurant(restaurantId);

    const reservations = await this.dataSource.getRepository(Reservation).find({
      where: { restaurantId, status },
      select: {
        id: true,
        status: true,
        partySize: true,
        dinerId: true,
        tableId: true,
        createdAt: true,
        expiresAt: true,
      },
      order: { expiresAt: 'ASC', id: 'ASC' },
    });
    if (reservations.length === 0) {
      return [];
    }

    const labelOf = await this.labels.read(reservations);
    const serverTime = this.clock.now();
    return reservations.map((reservation) =>
      toRestaurantReservation(reservation, labelOf(reservation), serverTime),
    );
  }
}
