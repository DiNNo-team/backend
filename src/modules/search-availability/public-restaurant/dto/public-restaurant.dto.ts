import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RESTAURANT_CATEGORIES,
  type RestaurantCategory,
} from '../../../restaurant-operations/index.js';
import type { Availability } from '../../availability/availability.types.js';
import {
  LatitudeField,
  LocationPair,
  LongitudeField,
} from '../../location/location-fields.js';

const AVAILABILITY_VALUES: Availability[] = [
  'available',
  'few',
  'none',
  'closed',
];

// Query of GET /v1/restaurants/:id/public: the diner's location, optional,
// both coordinates or neither. Same rules and messages as the search.
export class PublicRestaurantQueryDto {
  @ApiPropertyOptional({
    description:
      'Latitud del comensal, junto con lng, para calcular distanceKm. Puede estar fuera de Bogotá.',
    minimum: -90,
    maximum: 90,
    example: 4.655671,
  })
  @LatitudeField()
  @LocationPair()
  lat?: number;

  @ApiPropertyOptional({
    description: 'Longitud del comensal, junto con lat.',
    minimum: -180,
    maximum: 180,
    example: -74.057006,
  })
  @LongitudeField()
  lng?: number;
}

// Own class name: Swagger names schemas by class, and restaurant-operations
// already has a RestaurantScheduleResponseDto with this same shape.
export class PublicScheduleResponseDto {
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
    type: String,
    example: '11:00',
  })
  opensAt: string | null;

  @ApiProperty({
    description:
      'HH:MM; null si abre 24 horas. Si es menor que opensAt, cierra al día siguiente.',
    nullable: true,
    type: String,
    example: '23:00',
  })
  closesAt: string | null;
}

// Public detail of a restaurant for the diner. Never a count of tables.
export class PublicRestaurantResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '55bb0482-be1e-490b-9ba8-7533335d958b',
  })
  id: string;

  @ApiProperty({ example: 'Casa 72' })
  name: string;

  @ApiProperty({
    description:
      'Categoría del restaurante. null solo en restaurantes creados antes del registro completo.',
    enum: RESTAURANT_CATEGORIES,
    nullable: true,
    example: 'colombian',
  })
  category: RestaurantCategory | null;

  @ApiProperty({
    description:
      'null solo en restaurantes creados antes del registro completo.',
    nullable: true,
    type: String,
    example: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  })
  address: string | null;

  @ApiProperty({ example: 4.655671 })
  latitude: number;

  @ApiProperty({ example: -74.057006 })
  longitude: number;

  @ApiProperty({
    description:
      'Solo los días que abre, ordenados de lunes a domingo; un día cerrado no aparece. Mismo formato que GET /v1/restaurants/me.',
    type: [PublicScheduleResponseDto],
  })
  schedules: PublicScheduleResponseDto[];

  @ApiProperty({
    description:
      'Abierto ahora: el switch Abierto y la hora actual de Bogotá dentro del horario.',
    example: true,
  })
  isOpenNow: boolean;

  @ApiProperty({
    description:
      'available: Disponible · few: Pocas mesas · none: Sin mesas · closed: Cerrado (no está abierto ahora; solo aquí y en tiempo real, nunca en la búsqueda).',
    enum: AVAILABILITY_VALUES,
    example: 'available',
  })
  availability: Availability;

  @ApiPropertyOptional({
    description:
      'Distancia en km desde lat y lng, con 2 decimales. Solo aparece si se envían lat y lng.',
    example: 0.65,
  })
  distanceKm?: number;
}
