import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { TABLE_STATUSES, type TableStatus } from '../table.entity.js';

export const STATUS_INVALID =
  'Elige un estado para la mesa: Disponible, Reservada u Ocupada.';

export class UpdateTableStatusDto {
  @ApiProperty({
    enum: TABLE_STATUSES,
    example: 'occupied',
    description:
      'Estado nuevo: available = Disponible, reserved = Reservada, occupied = Ocupada. Inactiva no es un estado: no se pone por aquí.',
  })
  @IsIn(TABLE_STATUSES, { message: STATUS_INVALID })
  status: TableStatus;
}
