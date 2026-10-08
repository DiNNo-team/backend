import { ApiProperty } from '@nestjs/swagger';
import type { Restaurant } from '../restaurant.entity.js';

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

  static fromEntity(restaurant: Restaurant): RestaurantResponseDto {
    return {
      id: restaurant.id,
      name: restaurant.name,
    };
  }
}
