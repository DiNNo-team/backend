import { ApiProperty } from '@nestjs/swagger';
import {
  RESTAURANT_CATEGORIES,
  type Restaurant,
  type RestaurantCategory,
} from '../restaurant.entity.js';

// The restaurant as the web sees it. Meant to be shared by the restaurant
// GET (Santiago) and PATCH (Elizabeth): new columns are added here as new
// fields, so the response only grows and existing fields never change.
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

  static fromEntity(restaurant: Restaurant): RestaurantResponseDto {
    return {
      id: restaurant.id,
      name: restaurant.name,
      category: restaurant.category,
      address: restaurant.address,
    };
  }
}
