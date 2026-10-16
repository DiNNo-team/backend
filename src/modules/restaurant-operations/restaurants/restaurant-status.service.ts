import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  availabilityAffected,
  RESTAURANT_AVAILABILITY_AFFECTED,
} from '../shared/availability-affected.event.js';
import { requireRestaurant } from '../shared/restaurant-required.js';
import { Restaurant } from './restaurant.entity.js';

// Open/closed state of the restaurant (PBI 8). Manual only in Sprint 1: it
// does not look at the opening hours.
@Injectable()
export class RestaurantStatusService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private readonly events: EventEmitter2,
  ) {}

  async get(restaurantId: string | null): Promise<Restaurant> {
    return this.findSessionRestaurant(requireRestaurant(restaurantId));
  }

  async update(
    restaurantId: string | null,
    isOpen: boolean,
  ): Promise<Restaurant> {
    const ownerId = requireRestaurant(restaurantId);
    const current = await this.findSessionRestaurant(ownerId);
    // Same state (the web may send it again): nothing is written or emitted.
    if (current.isOpen === isOpen) {
      return current;
    }
    // Only isOpen, always on the session restaurant: save() of a loaded row
    // would write back stale name, category or address edited meanwhile.
    await this.restaurants.update({ id: ownerId }, { isOpen });
    // After the update is committed (a single statement, no transaction).
    this.events.emit(
      RESTAURANT_AVAILABILITY_AFFECTED,
      availabilityAffected(ownerId),
    );
    return this.findSessionRestaurant(ownerId);
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
