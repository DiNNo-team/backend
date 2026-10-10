import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

// ISO 8601, like restaurant_schedules.day_of_week: 1 = Monday ... 7 = Sunday.
export const DAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const;

// HH:MM, 24 hours. The database also accepts seconds, so the limit is here.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_INVALID = 'Indica el día con un número del 1 (lunes) al 7 (domingo).';
const OPEN_24H_INVALID =
  'Indica con true o false si el restaurante abre 24 horas ese día.';

// "El lunes", or "Un día" when dayOfWeek itself is invalid.
function dayLabel(day: Partial<RestaurantScheduleDto>): string {
  const name = Number.isInteger(day.dayOfWeek)
    ? DAY_NAMES[(day.dayOfWeek as number) - 1]
    : undefined;
  return name ? `El ${name}` : 'Un día';
}

// Opening and closing time of one day: none when open 24 hours; otherwise
// both, in HH:MM, and different from each other (closing earlier than
// opening is valid: it closes the next day).
@ValidatorConstraint({ name: 'scheduleTime' })
class ScheduleTimeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const day = args.object as RestaurantScheduleDto;
    if (day.isOpen24h === true) {
      return value === undefined || value === null;
    }
    if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
      return false;
    }
    return args.property !== 'closesAt' || value !== day.opensAt;
  }
}

function scheduleTimeMessage(args: ValidationArguments): string {
  const day = args.object as RestaurantScheduleDto;
  const label = dayLabel(day);
  const opening = args.property === 'opensAt';
  if (day.isOpen24h === true) {
    return `${label}: si abres 24 horas, no envíes la hora de ${opening ? 'apertura' : 'cierre'}.`;
  }
  if (typeof args.value !== 'string' || !TIME_PATTERN.test(args.value)) {
    return opening
      ? `${label}: escribe la hora de apertura en formato HH:MM, por ejemplo 09:30.`
      : `${label}: escribe la hora de cierre en formato HH:MM, por ejemplo 22:00.`;
  }
  return `${label}: la hora de cierre debe ser distinta de la de apertura. Si abres todo el día, marca Abierto 24 horas.`;
}

// One open day of the week. A closed day is not sent (it has no row).
export class RestaurantScheduleDto {
  @ApiProperty({
    description: 'Día de la semana: 1 = lunes … 7 = domingo.',
    minimum: 1,
    maximum: 7,
    example: 1,
  })
  @IsInt({ message: DAY_INVALID })
  @Min(1, { message: DAY_INVALID })
  @Max(7, { message: DAY_INVALID })
  dayOfWeek: number;

  @ApiProperty({
    description:
      'true si abre las 24 horas ese día: entonces no se envían opensAt ni closesAt.',
    example: false,
  })
  @IsBoolean({ message: OPEN_24H_INVALID })
  isOpen24h: boolean;

  @ApiPropertyOptional({
    description:
      'Hora de apertura, HH:MM en formato de 24 horas. Obligatoria si isOpen24h es false; no se envía si es true.',
    example: '09:00',
    pattern: TIME_PATTERN.source,
  })
  @Validate(ScheduleTimeConstraint, { message: scheduleTimeMessage })
  opensAt?: string;

  @ApiPropertyOptional({
    description:
      'Hora de cierre, HH:MM en formato de 24 horas. Distinta de la apertura; si es menor, cierra al día siguiente (por ejemplo 18:00 a 02:00). Obligatoria si isOpen24h es false; no se envía si es true.',
    example: '22:00',
    pattern: TIME_PATTERN.source,
  })
  @Validate(ScheduleTimeConstraint, { message: scheduleTimeMessage })
  closesAt?: string;
}

const SCHEDULES_NOT_A_LIST =
  'Envía los horarios como una lista, con un elemento por cada día que abres.';

// Every array rule also fails when schedules is not a list; there the only
// useful message is SCHEDULES_NOT_A_LIST (the pipe drops the repeated one).
const listMessage =
  (message: string) =>
  ({ value }: ValidationArguments): string =>
    Array.isArray(value) ? message : SCHEDULES_NOT_A_LIST;

// Validation of the whole opening hours list, shared by registration and
// editing so both apply exactly the same rules. Swagger metadata stays in each
// DTO, because only there the field is required or optional.
export function SchedulesField(): PropertyDecorator {
  return applyDecorators(
    IsArray({ message: SCHEDULES_NOT_A_LIST }),
    ArrayNotEmpty({
      message: listMessage(
        'Indica al menos un día en que abre tu restaurante.',
      ),
    }),
    ArrayMaxSize(7, {
      message: listMessage(
        'Envía como máximo un horario por cada día de la semana.',
      ),
    }),
    ArrayUnique((day: RestaurantScheduleDto) => day?.dayOfWeek, {
      message: listMessage(
        'Cada día de la semana va una sola vez en los horarios.',
      ),
    }),
    ValidateNested({
      each: true,
      message: listMessage(
        'Cada horario debe ser un objeto con dayOfWeek, isOpen24h, opensAt y closesAt.',
      ),
    }),
    Type(() => RestaurantScheduleDto),
  );
}
