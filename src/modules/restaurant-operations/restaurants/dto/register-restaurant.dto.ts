import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import { RestaurantFieldsDto } from './restaurant-fields.dto.js';
import { RestaurantScheduleDto } from './restaurant-schedule.dto.js';

const SCHEDULES_NOT_A_LIST =
  'Envía los horarios como una lista, con un elemento por cada día que abres.';

// Every array rule also fails when schedules is not a list; there the only
// useful message is SCHEDULES_NOT_A_LIST (the pipe drops the repeated one).
const listMessage =
  (message: string) =>
  ({ value }: ValidationArguments): string =>
    Array.isArray(value) ? message : SCHEDULES_NOT_A_LIST;

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
  @IsArray({ message: SCHEDULES_NOT_A_LIST })
  @ArrayNotEmpty({
    message: listMessage('Indica al menos un día en que abre tu restaurante.'),
  })
  @ArrayMaxSize(7, {
    message: listMessage(
      'Envía como máximo un horario por cada día de la semana.',
    ),
  })
  @ArrayUnique((day: RestaurantScheduleDto) => day?.dayOfWeek, {
    message: listMessage(
      'Cada día de la semana va una sola vez en los horarios.',
    ),
  })
  @ValidateNested({
    each: true,
    message: listMessage(
      'Cada horario debe ser un objeto con dayOfWeek, isOpen24h, opensAt y closesAt.',
    ),
  })
  @Type(() => RestaurantScheduleDto)
  schedules: RestaurantScheduleDto[];
}
