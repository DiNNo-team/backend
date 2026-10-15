import { ApiProperty } from '@nestjs/swagger';
import {
  RESTAURANT_CATEGORIES,
  type Restaurant,
  type RestaurantCategory,
} from '../restaurant.entity.js';

// The restaurant as the web sees it. Meant to be shared by the restaurant
// GET (Santiago) and PATCH (Elizabeth): new columns are added here as new
// fields, so the response only grows and existing fields never change.
// Exception on purpose: isOpen is not here, because the open/closed state has
// its own endpoints (GET and PATCH /v1/restaurants/me/status).
export class RestaurantResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a',
  })
  id: string;

  @ApiProperty({ example: 'La Esquina de Ana' })
  name: string;

  @ApiProperty({
    description:
      'Categoría del restaurante. null solo en restaurantes creados antes del registro completo (por ejemplo, el del seed).',
    enum: RESTAURANT_CATEGORIES,
    nullable: true,
    example: 'colombian',
  })
  category: RestaurantCategory | null;

  @ApiProperty({
    description:
      'Dirección del restaurante. null solo en restaurantes creados antes del registro completo (por ejemplo, el del seed).',
    nullable: true,
    example: 'Calle 72 # 10-34, Bogotá',
  })
  address: string | null;

  @ApiProperty({
    description:
      'Latitud con hasta 6 decimales. null si el restaurante todavía no tiene ubicación: la web muestra «Completa tu ubicación».',
    type: Number,
    nullable: true,
    example: 4.655671,
  })
  latitude: number | null;

  @ApiProperty({
    description:
      'Longitud con hasta 6 decimales. null si el restaurante todavía no tiene ubicación.',
    type: Number,
    nullable: true,
    example: -74.057006,
  })
  longitude: number | null;

  static fromEntity(restaurant: Restaurant): RestaurantResponseDto {
    return {
      id: restaurant.id,
      name: restaurant.name,
      category: restaurant.category,
      address: restaurant.address,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    };
  }
}
