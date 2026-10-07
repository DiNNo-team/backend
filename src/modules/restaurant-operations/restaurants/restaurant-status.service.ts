import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { requireRestaurant } from '../shared/restaurant-required.js';
import { Restaurant } from './restaurant.entity.js';

// Open/closed state of the restaurant (PBI 8). Manual only in Sprint 1: it
// does not look at the opening hours.
@Injectable()
export class RestaurantStatusService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
  ) {}

  async get(restaurantId: string | null): Promise<Restaurant> {
    return this.findSessionRestaurant(requireRestaurant(restaurantId));
  }

  async update(
    restaurantId: string | null,
    isOpen: boolean,
  ): Promise<Restaurant> {
    const ownerId = requireRestaurant(restaurantId);
    const restaurant = await this.findSessionRestaurant(ownerId);
    // id last: the session restaurant is always the one updated.
    return this.restaurants.save(
      this.restaurants.merge(restaurant, { isOpen }, { id: ownerId }),
    );
  }

  private async findSessionRestaurant(id: string): Promise<Restaurant> {
    const restaurant = await this.restaurants.findOneBy({ id });
    if (!restaurant) {
      // users.restaurant_id has a foreign key to restaurants, so this cannot happen
      // with valid data: let the global filter log it and answer the generic 500.
      throw new Error(`Restaurant ${id} of the session user not found`);
    }
    return restaurant;
  }
}
