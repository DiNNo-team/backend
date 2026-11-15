import { ApiProperty } from '@nestjs/swagger';
import {
  REJECTED,
  RESTAURANT_APPROVAL_STATUSES,
  type RestaurantApprovalStatus,
} from '../../../identity-access/index.js';
import { RestaurantScheduleResponseDto } from '../../restaurants/dto/restaurant-profile-response.dto.js';
import type { RestaurantSchedule } from '../../restaurants/restaurant-schedule.entity.js';
import {
  RESTAURANT_CATEGORIES,
  type Restaurant,
  type RestaurantCategory,
} from '../../restaurants/restaurant.entity.js';

// Una solicitud de restaurante como la ve el administrador de DiNNo en la lista.
// ownerEmail solo sale por las rutas /v1/admin/*: nunca a comensales ni a otros
// restaurantes.
export class AdminRestaurantItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'La Esquina de Ana' })
  name: string;

  @ApiProperty({ enum: RESTAURANT_CATEGORIES, nullable: true })
  category: RestaurantCategory | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Calle 72 # 10-34, Bogotá',
  })
  address: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+573001234567' })
  contactPhone: string | null;

  @ApiProperty({ enum: RESTAURANT_APPROVAL_STATUSES, example: 'pending' })
  approvalStatus: RestaurantApprovalStatus;

  @ApiProperty({
    description:
      'Fecha y hora (ISO 8601 UTC) en que se envió la solicitud o se reenvió después de un rechazo.',
    example: '2026-11-15T14:30:00.000Z',
  })
  submittedAt: string;

  @ApiProperty({
    description:
      'Fecha y hora (ISO 8601 UTC) de la última revisión. null si nadie la revisó (pendiente, o aprobado por el equipo sin revisión).',
    type: String,
    nullable: true,
    example: null,
  })
  reviewedAt: string | null;

  @ApiProperty({
    description:
      'Correo del dueño (restaurant_admin) del restaurante; si hubiera varios, el de la cuenta más antigua. null si no tiene dueño.',
    type: String,
    nullable: true,
    example: 'duena@example.com',
  })
  ownerEmail: string | null;

  static fromEntity(
    restaurant: Restaurant,
    ownerEmail: string | null,
  ): AdminRestaurantItemDto {
    return {
      id: restaurant.id,
      name: restaurant.name,
      category: restaurant.category,
      address: restaurant.address,
      contactPhone: restaurant.contactPhone,
      approvalStatus: restaurant.approvalStatus,
      submittedAt: restaurant.submittedAt.toISOString(),
      reviewedAt: restaurant.reviewedAt?.toISOString() ?? null,
      ownerEmail,
    };
  }
}

export class AdminRestaurantPageDto {
  @ApiProperty({ type: [AdminRestaurantItemDto] })
  items: AdminRestaurantItemDto[];

  @ApiProperty({
    description: 'Total de solicitudes con ese estado (todas las páginas).',
    type: 'integer',
    example: 3,
  })
  total: number;

  @ApiProperty({ type: 'integer', example: 1 })
  page: number;

  @ApiProperty({ type: 'integer', example: 20 })
  pageSize: number;
}

// El detalle de una solicitud: lo de la lista más la ubicación, los horarios y
// la auditoría de la revisión.
export class AdminRestaurantDetailDto extends AdminRestaurantItemDto {
  @ApiProperty({ type: Number, nullable: true, example: 4.655671 })
  latitude: number | null;

  @ApiProperty({ type: Number, nullable: true, example: -74.057006 })
  longitude: number | null;

  @ApiProperty({
    description:
      'Solo los días que abre, ordenados de lunes a domingo (igual que GET /restaurants/me).',
    type: [RestaurantScheduleResponseDto],
  })
  schedules: RestaurantScheduleResponseDto[];

  @ApiProperty({
    description: 'Motivo del rechazo. null si no está rechazado.',
    type: String,
    nullable: true,
    example: null,
  })
  rejectionReason: string | null;

  @ApiProperty({
    description:
      'Correo del administrador de DiNNo que hizo la última revisión. null si nadie la revisó.',
    type: String,
    nullable: true,
    example: null,
  })
  reviewedByEmail: string | null;

  @ApiProperty({
    description: 'Fecha y hora (ISO 8601 UTC) en que se creó el restaurante.',
    example: '2026-11-15T14:30:00.000Z',
  })
  createdAt: string;

  static fromParts(
    restaurant: Restaurant,
    schedules: RestaurantSchedule[],
    emails: { ownerEmail: string | null; reviewedByEmail: string | null },
  ): AdminRestaurantDetailDto {
    return {
      ...AdminRestaurantItemDto.fromEntity(restaurant, emails.ownerEmail),
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      schedules: [...schedules]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((schedule) => RestaurantScheduleResponseDto.fromEntity(schedule)),
      rejectionReason:
        restaurant.approvalStatus === REJECTED
          ? restaurant.rejectionReason
          : null,
      reviewedByEmail: emails.reviewedByEmail,
      createdAt: restaurant.createdAt.toISOString(),
    };
  }
}
