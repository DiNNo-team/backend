import { ApiProperty } from '@nestjs/swagger';
import type { RestaurantCategory } from '../../../restaurant-operations/index.js';
import type { AvailabilityLevel } from '../../availability/availability.types.js';
import { ZONE_IDS, type Zone, type ZoneId } from '../zones.js';

const AVAILABILITY_LEVELS: AvailabilityLevel[] = ['available', 'few', 'none'];

export class ZoneResponseDto {
  @ApiProperty({ enum: ZONE_IDS, example: 'calle-72' })
  id: ZoneId;

  @ApiProperty({ example: 'Calle 72' })
  name: string;

  @ApiProperty({ description: 'Punto central aproximado.', example: 4.6557 })
  latitude: number;

  @ApiProperty({ description: 'Punto central aproximado.', example: -74.057 })
  longitude: number;

  static fromZone(zone: Zone): ZoneResponseDto {
    return {
      id: zone.id,
      name: zone.name,
      latitude: zone.latitude,
      longitude: zone.longitude,
    };
  }
}

// One restaurant of the search. Never a count of tables (CLAUDE.md, section 10).
export class SearchResultDto {
  @ApiProperty({
    format: 'uuid',
    example: 'a4765bce-fc28-496c-bdbc-68bd1599f1d9',
  })
  id: string;

  @ApiProperty({ example: 'Casa 72' })
  name: string;

  @ApiProperty({
    description:
      'Categoría del contrato (colombian, italian, mexican, asian, grill, fast_food, healthy, seafood, cafe, other). null solo en restaurantes creados antes del registro completo.',
    nullable: true,
    type: String,
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
      'Distancia en km desde la ubicación o el centro de la zona, con 2 decimales. El formato para mostrar («a 650 m», «a 1,4 km») lo hace la app.',
    example: 0.65,
  })
  distanceKm: number;

  @ApiProperty({
    description:
      'available: Disponible · few: Pocas mesas · none: Sin mesas. Nunca closed: un restaurante cerrado no aparece en la búsqueda.',
    enum: AVAILABILITY_LEVELS,
    example: 'available',
  })
  availability: AvailabilityLevel;
}
