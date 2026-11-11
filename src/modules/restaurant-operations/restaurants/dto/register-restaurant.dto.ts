import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContactPhoneField } from './contact-phone-field.js';
import { RestaurantFieldsDto } from './restaurant-fields.dto.js';
import {
  RestaurantScheduleDto,
  SchedulesField,
} from './restaurant-schedule.dto.js';

// Registration (PBI 3): the shared restaurant fields plus the opening hours.
// The hours stay out of RestaurantFieldsDto because they are stored in
// restaurant_schedules, not in restaurants, so editing cannot copy them.
export class RegisterRestaurantDto extends RestaurantFieldsDto {
  @ApiProperty({
    description:
      'Horario de atención: un elemento por cada día que abre (al menos uno, sin repetir días). Un día cerrado no se envía.',
    type: [RestaurantScheduleDto],
    minItems: 1,
    maxItems: 7,
  })
  @SchedulesField()
  schedules: RestaurantScheduleDto[];

  @ApiPropertyOptional({
    description:
      'Teléfono de contacto, opcional. De 7 a 15 dígitos; se aceptan espacios, guiones, puntos, paréntesis y un + inicial, y se guarda sin separadores. No acepta null.',
    example: '+57 300 123 4567',
  })
  @ContactPhoneField({ required: false })
  contactPhone?: string;
}
