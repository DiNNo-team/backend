import { ApiProperty } from '@nestjs/swagger';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../../reservations/reservation.constants.js';

const DATE_DESCRIPTION = 'Fecha ISO 8601 en UTC.';

// RestaurantReservation (§12.8). Nunca trae el código: si la web lo mostrara, el
// check-in no comprobaría nada (§12.6).
export class RestaurantReservationResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  id: string;

  @ApiProperty({ enum: RESERVATION_STATUSES, example: 'active' })
  status: ReservationStatus;

  @ApiProperty({ example: 2, description: 'Personas de la reserva.' })
  partySize: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ana',
    description:
      'Nombre del comensal, nunca un fragmento de su correo. Con null, la web muestra "Comensal".',
  })
  dinerName: string | null;

  @ApiProperty({
    format: 'uuid',
    example: '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d',
  })
  tableId: string;

  @ApiProperty({
    example: '04',
    description: 'Identificador de la mesa; la web lo muestra como "Mesa 04".',
  })
  tableIdentifier: string;

  @ApiProperty({
    example: '2026-11-05T17:30:00.000Z',
    description: DATE_DESCRIPTION,
  })
  createdAt: string;

  @ApiProperty({
    example: '2026-11-05T17:45:00.000Z',
    description: DATE_DESCRIPTION,
  })
  expiresAt: string;

  @ApiProperty({
    example: '2026-11-05T17:35:00.000Z',
    description:
      'Hora del servidor al responder, la misma en todas las reservas. Fecha ISO 8601 en UTC.',
  })
  serverTime: string;
}
