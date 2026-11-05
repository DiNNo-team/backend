import { ApiProperty } from '@nestjs/swagger';
import { ReservationResponseDto } from './reservation-response.dto.js';

// Respuesta de GET /v1/reservations/active (CLAUDE.md §12.8).
export class ActiveReservationResponseDto {
  @ApiProperty({
    type: ReservationResponseDto,
    nullable: true,
    description:
      'La reserva activa del comensal, o null si no tiene (200, nunca 404). Una reserva vencida no se devuelve como activa: se vence al leer y aquí llega null.',
  })
  reservation: ReservationResponseDto | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T17:00:00.412Z',
    description:
      'Hora del servidor al responder (ISO 8601 UTC); la misma que lleva reservation.serverTime.',
  })
  serverTime: string;
}
