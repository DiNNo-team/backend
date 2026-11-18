import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { SUSPENSION_REASON_MAX_LENGTH } from '../../restaurants/restaurant.entity.js';

export const SUSPENSION_REASON_MIN_LENGTH = 10;
export const SUSPENSION_REASON_INVALID = `Escribe el motivo de la suspensión, de ${SUSPENSION_REASON_MIN_LENGTH} a ${SUSPENSION_REASON_MAX_LENGTH} caracteres, para que el restaurante sepa por qué.`;

// Body de POST /v1/admin/restaurants/:id/suspend. El motivo se recorta antes de
// validar: solo espacios queda vacío y da 400.
export class SuspendRestaurantDto {
  @ApiProperty({
    description: `Motivo de la suspensión que verá el restaurante mientras esté suspendido, de ${SUSPENSION_REASON_MIN_LENGTH} a ${SUSPENSION_REASON_MAX_LENGTH} caracteres (sin contar los espacios de los extremos).`,
    minLength: SUSPENSION_REASON_MIN_LENGTH,
    maxLength: SUSPENSION_REASON_MAX_LENGTH,
    example:
      'Varios comensales reportaron que las mesas reservadas no estaban disponibles.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: SUSPENSION_REASON_INVALID })
  @Length(SUSPENSION_REASON_MIN_LENGTH, SUSPENSION_REASON_MAX_LENGTH, {
    message: SUSPENSION_REASON_INVALID,
  })
  reason: string;
}
