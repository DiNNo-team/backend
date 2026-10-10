import { ApiProperty } from '@nestjs/swagger';
import type { RestaurantSchedule } from '../restaurant-schedule.entity.js';
import type { Restaurant } from '../restaurant.entity.js';
import { RestaurantResponseDto } from './restaurant-response.dto.js';

// The database returns time columns as HH:MM:SS; the API speaks HH:MM.
function toHourMinute(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

export class RestaurantScheduleResponseDto {
  @ApiProperty({
    description: 'Día de la semana: 1 = lunes … 7 = domingo.',
    example: 1,
  })
  dayOfWeek: number;

  @ApiProperty({ example: false })
  isOpen24h: boolean;

  @ApiProperty({
    description: 'HH:MM; null si abre 24 horas.',
    nullable: true,
    example: '09:00',
  })
  opensAt: string | null;

  @ApiProperty({
    description:
      'HH:MM; null si abre 24 horas. Si es menor que opensAt, cierra al día siguiente.',
    nullable: true,
    example: '22:00',
  })
  closesAt: string | null;

  static fromEntity(
    schedule: RestaurantSchedule,
  ): RestaurantScheduleResponseDto {
    return {
      dayOfWeek: schedule.dayOfWeek,
      isOpen24h: schedule.isOpen24h,
      opensAt: toHourMinute(schedule.opensAt),
      closesAt: toHourMinute(schedule.closesAt),
    };
  }
}

// The restaurant with its opening hours: GET /restaurants/me, the
// registration and PATCH /restaurants/me answer with it.
export class RestaurantProfileResponseDto extends RestaurantResponseDto {
  @ApiProperty({
    description:
      'Solo los días que abre, ordenados de lunes a domingo; un día cerrado no aparece.',
    type: [RestaurantScheduleResponseDto],
  })
  schedules: RestaurantScheduleResponseDto[];

  static fromEntities(
    restaurant: Restaurant,
    schedules: RestaurantSchedule[],
  ): RestaurantProfileResponseDto {
    return {
      ...RestaurantResponseDto.fromEntity(restaurant),
      schedules: [...schedules]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((schedule) => RestaurantScheduleResponseDto.fromEntity(schedule)),
    };
  }
}
