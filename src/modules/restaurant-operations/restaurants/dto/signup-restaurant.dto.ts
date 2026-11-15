import { ApiProperty } from '@nestjs/swagger';
import { ContactPhoneField } from './contact-phone-field.js';
import { RestaurantFieldsDto } from './restaurant-fields.dto.js';
import {
  RestaurantScheduleDto,
  SchedulesField,
} from './restaurant-schedule.dto.js';

// POST /v1/restaurants/signup: the same fields as RegisterRestaurantDto plus a
// required contact phone. It does not extend RegisterRestaurantDto on purpose:
// there contactPhone is optional, and class-validator would carry its
// ValidateIf over to this class.
export class SignupRestaurantDto extends RestaurantFieldsDto {
  @ApiProperty({
    description:
      'Horario de atención: un elemento por cada día que abre (al menos uno, sin repetir días). Un día cerrado no se envía.',
    type: [RestaurantScheduleDto],
    minItems: 1,
    maxItems: 7,
  })
  @SchedulesField()
  schedules: RestaurantScheduleDto[];

  @ApiProperty({
    description:
      'Teléfono de contacto del restaurante, para que DiNNo pueda comunicarse durante la revisión. De 7 a 15 dígitos; se aceptan espacios, guiones, puntos, paréntesis y un + inicial, y se guarda sin separadores.',
    example: '+57 300 123 4567',
  })
  @ContactPhoneField({ required: true })
  contactPhone: string;
}
