import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../../reservations/reservation.constants.js';

export const RESERVATION_STATUS_INVALID = `El estado de la reserva debe ser uno de estos: ${RESERVATION_STATUSES.join(', ')}.`;

// Query de GET /v1/restaurants/me/reservations. El restaurante sale de la sesión:
// cualquier otro parámetro se rechaza con 400.
export class RestaurantReservationsQueryDto {
  @ApiPropertyOptional({
    enum: RESERVATION_STATUSES,
    default: 'active',
    description: 'Estado de las reservas que se quieren ver.',
  })
  @IsOptional()
  @IsIn(RESERVATION_STATUSES, { message: RESERVATION_STATUS_INVALID })
  status?: ReservationStatus;
}
