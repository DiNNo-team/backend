import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import {
  RESERVATION_MAX_PARTY_SIZE,
  RESERVATION_MIN_PARTY_SIZE,
} from '../reservation.constants.js';

export const RESTAURANT_ID_INVALID =
  'El restaurante no es válido. Elígelo de nuevo desde la búsqueda.';
export const PARTY_SIZE_RANGE = `Las personas van de ${RESERVATION_MIN_PARTY_SIZE} a ${RESERVATION_MAX_PARTY_SIZE}.`;

// El comensal sale de la sesión, nunca del body.
export class CreateReservationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Id del restaurante (el de la búsqueda o el detalle).',
    example: '55bb0482-be1e-490b-9ba8-7533335d958b',
  })
  @IsUUID(undefined, { message: RESTAURANT_ID_INVALID })
  restaurantId: string;

  @ApiProperty({
    type: 'integer',
    minimum: RESERVATION_MIN_PARTY_SIZE,
    maximum: RESERVATION_MAX_PARTY_SIZE,
    description: 'Número de personas de la reserva.',
    example: 2,
  })
  @IsInt({ message: PARTY_SIZE_RANGE })
  @Min(RESERVATION_MIN_PARTY_SIZE, { message: PARTY_SIZE_RANGE })
  @Max(RESERVATION_MAX_PARTY_SIZE, { message: PARTY_SIZE_RANGE })
  partySize: number;
}
