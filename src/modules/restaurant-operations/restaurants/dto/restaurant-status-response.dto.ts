import { ApiProperty } from '@nestjs/swagger';
import type { Restaurant } from '../restaurant.entity.js';

// Open/closed state of the session restaurant (PBI 8), answered by both the
// GET and the PATCH of /v1/restaurants/me/status.
export class RestaurantStatusResponseDto {
  @ApiProperty({
    description: 'true = Abierto, false = Cerrado.',
    example: true,
  })
  isOpen: boolean;

  static fromEntity(restaurant: Restaurant): RestaurantStatusResponseDto {
    return { isOpen: restaurant.isOpen };
  }
}
