import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { REJECTION_REASON_MAX_LENGTH } from '../../restaurants/restaurant.entity.js';

export const REJECTION_REASON_MIN_LENGTH = 10;
export const REJECTION_REASON_INVALID = `Escribe el motivo del rechazo, de ${REJECTION_REASON_MIN_LENGTH} a ${REJECTION_REASON_MAX_LENGTH} caracteres, para que el restaurante sepa qué corregir.`;

// Body de POST /v1/admin/restaurants/:id/reject. El motivo se recorta antes de
// validar: solo espacios queda vacío y da 400.
export class RejectRestaurantDto {
  @ApiProperty({
    description: `Motivo del rechazo que verá el restaurante, de ${REJECTION_REASON_MIN_LENGTH} a ${REJECTION_REASON_MAX_LENGTH} caracteres (sin contar los espacios de los extremos).`,
    minLength: REJECTION_REASON_MIN_LENGTH,
    maxLength: REJECTION_REASON_MAX_LENGTH,
    example:
      'La dirección no coincide con el local. Corrígela y vuelve a enviarla.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: REJECTION_REASON_INVALID })
  @Length(REJECTION_REASON_MIN_LENGTH, REJECTION_REASON_MAX_LENGTH, {
    message: REJECTION_REASON_INVALID,
  })
  reason: string;
}
