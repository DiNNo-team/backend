import { ApiProperty } from '@nestjs/swagger';
import {
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../reservation.constants.js';

const DATE_DESCRIPTION = 'Fecha ISO 8601 en UTC.';

export class ReservationRestaurantDto {
  @ApiProperty({
    format: 'uuid',
    example: '55bb0482-be1e-490b-9ba8-7533335d958b',
  })
  id: string;

  @ApiProperty({ example: 'Casa 72' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  })
  address: string | null;

  @ApiProperty({ example: 4.655671 })
  latitude: number;

  @ApiProperty({ example: -74.057006 })
  longitude: number;
}

export class ReservationTableDto {
  @ApiProperty({
    example: '04',
    description: 'Identificador de la mesa; la app lo muestra como "Mesa 04".',
  })
  identifier: string;

  @ApiProperty({ example: 4, description: 'Personas que caben en la mesa.' })
  capacity: number;
}

// La microreserva como la ve el comensal (CLAUDE.md §12.8). La comparten
// POST /reservations, GET /reservations/active y GET /reservations/:id.
export class ReservationResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'K7M4QX',
    description:
      'Código de 6 caracteres que el comensal muestra en el restaurante. Solo viene cuando status es active; en los demás estados es null.',
  })
  code: string | null;

  @ApiProperty({
    enum: RESERVATION_STATUSES,
    example: 'active',
    description:
      'active = Activa, cancelled = Cancelada, expired = Vencida, completed = Cumplida.',
  })
  status: ReservationStatus;

  @ApiProperty({ type: 'integer', example: 2 })
  partySize: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T17:00:00.000Z',
    description: DATE_DESCRIPTION,
  })
  createdAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T17:15:00.000Z',
    description: `Cuándo vence la reserva. ${DATE_DESCRIPTION}`,
  })
  expiresAt: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T17:00:00.412Z',
    description:
      'Hora del servidor al responder. La app calcula la diferencia con su reloj y cuenta hacia atrás con eso.',
  })
  serverTime: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'null mientras no esté cancelada.',
  })
  cancelledAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'null mientras no esté vencida.',
  })
  expiredAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'null mientras no se haya hecho el check-in.',
  })
  checkedInAt: string | null;

  @ApiProperty({ type: ReservationRestaurantDto })
  restaurant: ReservationRestaurantDto;

  @ApiProperty({ type: ReservationTableDto })
  table: ReservationTableDto;
}
