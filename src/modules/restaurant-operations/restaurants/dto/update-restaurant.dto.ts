import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { ContactPhoneField } from './contact-phone-field.js';
import { RestaurantFieldsDto } from './restaurant-fields.dto.js';
import {
  RestaurantScheduleDto,
  SchedulesField,
} from './restaurant-schedule.dto.js';

// Every field optional (PATCH), same rules as registration. With
// skipNullProperties: false only an absent field is skipped: null is validated
// and rejected, so it can never reach a NOT NULL column.
export class UpdateRestaurantDto extends PartialType(RestaurantFieldsDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    description:
      'Horario de atención completo: reemplaza todos los horarios guardados. Mismas reglas que el registro: un elemento por cada día que abre (al menos uno, sin repetir días); un día cerrado no se envía. Si no se envía, los horarios no cambian.',
    type: [RestaurantScheduleDto],
    minItems: 1,
    maxItems: 7,
  })
  // Not @IsOptional: that would also let null through. Only an absent list
  // is skipped; null and [] are rejected like in registration.
  @ValidateIf((_, value) => value !== undefined)
  @SchedulesField()
  schedules?: RestaurantScheduleDto[];

  @ApiPropertyOptional({
    description:
      'Teléfono de contacto. Mismas reglas que el registro público: de 7 a 15 dígitos; se aceptan espacios, guiones, puntos, paréntesis y un + inicial, y se guarda sin separadores. No acepta null. Si no se envía, no cambia.',
    example: '+57 300 123 4567',
  })
  @ContactPhoneField({ required: false })
  contactPhone?: string;
}
