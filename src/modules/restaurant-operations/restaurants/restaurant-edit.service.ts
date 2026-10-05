import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { requireRestaurant } from '../shared/restaurant-required.js';
import type { RestaurantFieldsDto } from './dto/restaurant-fields.dto.js';
import type { UpdateRestaurantDto } from './dto/update-restaurant.dto.js';
import { Restaurant } from './restaurant.entity.js';

export const NO_CHANGES_MESSAGE =
  'No hay cambios para guardar. Cambia al menos un dato del restaurante.';

// Editing the restaurant data (PBI 4). Registration (PBI 3) lives in its own
// files; both share the field rules in dto/restaurant-fields.dto.ts.
@Injectable()
export class RestaurantEditService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
  ) {}

  async update(
    restaurantId: string | null,
    dto: UpdateRestaurantDto,
  ): Promise<Restaurant> {
    const ownerId = requireRestaurant(restaurantId);
    const changes = sentFields(dto);
    // A list, like the other validation 400s.
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException([NO_CHANGES_MESSAGE]);
    }

    const restaurant = await this.restaurants.findOneBy({ id: ownerId });
    if (!restaurant) {
      // users.restaurant_id is a foreign key, so this means broken data:
      // let the global filter log it and answer the generic 500.
      throw new Error(`Restaurant ${ownerId} of the session user not found`);
    }
    // id last: whatever the changes carry, the session restaurant is updated.
    return this.restaurants.save(
      this.restaurants.merge(restaurant, changes, { id: ownerId }),
    );
  }
}

// Each DTO field is copied to the entity property with the same name.
// Pick fails to compile if RestaurantFieldsDto gets a field the entity lacks.
type RestaurantChanges = Partial<Pick<Restaurant, keyof RestaurantFieldsDto>>;

// Only the fields the client sent: a PATCH leaves the rest untouched. Generic
// on purpose, so fields added to RestaurantFieldsDto need no change here.
function sentFields(dto: UpdateRestaurantDto): RestaurantChanges {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  );
}
