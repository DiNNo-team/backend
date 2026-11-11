import { ApiProperty } from '@nestjs/swagger';
import {
  REJECTED,
  RESTAURANT_APPROVAL_STATUSES,
  type RestaurantApprovalStatus,
} from '../../../identity-access/index.js';
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
// registration, the sign-up and PATCH /restaurants/me answer with it.
export class RestaurantProfileResponseDto extends RestaurantResponseDto {
  @ApiProperty({
    description:
      'Solo los días que abre, ordenados de lunes a domingo; un día cerrado no aparece.',
    type: [RestaurantScheduleResponseDto],
  })
  schedules: RestaurantScheduleResponseDto[];

  @ApiProperty({
    description:
      'Reservas de DiNNo activas del restaurante (status active y todavía no vencidas). 0 en el registro. La web lo usa para avisar al cerrar el restaurante: «Tienes N reservas en curso; se mantendrán hasta que lleguen o se venzan.»',
    type: 'integer',
    minimum: 0,
    example: 2,
  })
  activeReservationsCount: number;

  @ApiProperty({
    description:
      'Estado de aprobación del restaurante: pending (en revisión), approved (aprobado: visible para los comensales y operable) o rejected (no aprobado). Los restaurantes registrados por un usuario habilitado por el equipo nacen approved; los del registro público (POST /v1/restaurants/signup), pending.',
    enum: RESTAURANT_APPROVAL_STATUSES,
    example: 'approved',
  })
  approvalStatus: RestaurantApprovalStatus;

  @ApiProperty({
    description:
      'Motivo por el que no se aprobó. null si no aplica (pendiente, aprobado o sin motivo).',
    type: String,
    nullable: true,
    example: null,
  })
  rejectionReason: string | null;

  @ApiProperty({
    description:
      'Teléfono de contacto, sin separadores (dígitos y un + inicial opcional). null si el restaurante no lo registró.',
    type: String,
    nullable: true,
    example: '+573001234567',
  })
  contactPhone: string | null;

  static fromEntities(
    restaurant: Restaurant,
    schedules: RestaurantSchedule[],
    activeReservationsCount: number,
  ): RestaurantProfileResponseDto {
    return {
      ...RestaurantResponseDto.fromEntity(restaurant),
      schedules: [...schedules]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((schedule) => RestaurantScheduleResponseDto.fromEntity(schedule)),
      activeReservationsCount,
      approvalStatus: restaurant.approvalStatus,
      // Only a rejected restaurant has a reason to show.
      rejectionReason:
        restaurant.approvalStatus === REJECTED
          ? restaurant.rejectionReason
          : null,
      contactPhone: restaurant.contactPhone,
    };
  }
}
