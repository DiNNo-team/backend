import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  type CurrentUserData,
  UsersService,
} from '../../identity-access/index.js';
import { requireRestaurant } from '../shared/restaurant-required.js';
import type { RegisterRestaurantDto } from './dto/register-restaurant.dto.js';
import type { RestaurantScheduleDto } from './dto/restaurant-schedule.dto.js';
import { RestaurantSchedule } from './restaurant-schedule.entity.js';
import { Restaurant } from './restaurant.entity.js';

export const ALREADY_REGISTERED_MESSAGE =
  'Ya registraste tu restaurante. Para cambiar sus datos, entra a Restaurante.';

export interface RestaurantProfile {
  restaurant: Restaurant;
  schedules: RestaurantSchedule[];
}

// Registering and reading the session user's restaurant (PBI 3). Editing
// lives in its own files (PBI 4); both share dto/restaurant-fields.dto.ts.
@Injectable()
export class RestaurantRegistrationService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    @InjectRepository(RestaurantSchedule)
    private readonly schedules: Repository<RestaurantSchedule>,
    private readonly users: UsersService,
  ) {}

  // Restaurant, schedules and the link to the user share one transaction: a
  // user who already has a restaurant (also one registered at the same time)
  // gets a 409 and nothing is saved. users belongs to identity-access, so the
  // link goes through its exported UsersService, never a direct write.
  async register(
    user: CurrentUserData,
    dto: RegisterRestaurantDto,
  ): Promise<RestaurantProfile> {
    if (user.restaurantId !== null) {
      throw new ConflictException(ALREADY_REGISTERED_MESSAGE);
    }

    return this.restaurants.manager.transaction(async (manager) => {
      const restaurant = await manager.save(
        manager.create(Restaurant, {
          name: dto.name,
          category: dto.category,
          address: dto.address,
        }),
      );
      const schedules = await manager.save(
        dto.schedules.map((day) =>
          manager.create(RestaurantSchedule, toScheduleRow(restaurant.id, day)),
        ),
      );
      const linked = await this.users.assignRestaurantIfNone(
        user.userId,
        restaurant.id,
        manager,
      );
      if (!linked) {
        throw new ConflictException(ALREADY_REGISTERED_MESSAGE);
      }
      return { restaurant, schedules };
    });
  }

  async findMine(restaurantId: string | null): Promise<RestaurantProfile> {
    const ownerId = requireRestaurant(restaurantId);
    const restaurant = await this.restaurants.findOneBy({ id: ownerId });
    if (!restaurant) {
      // users.restaurant_id has a foreign key to restaurants, so this cannot happen
      // with valid data: let the global filter log it and answer the generic 500.
      throw new Error(`Restaurant ${ownerId} of the session user not found`);
    }
    const schedules = await this.schedules.find({
      where: { restaurantId: ownerId },
      order: { dayOfWeek: 'ASC' },
    });
    return { restaurant, schedules };
  }
}

// A 24-hour day stores no times, whatever the client sent (the DTO rejects them).
function toScheduleRow(
  restaurantId: string,
  day: RestaurantScheduleDto,
): Partial<RestaurantSchedule> {
  return {
    restaurantId,
    dayOfWeek: day.dayOfWeek,
    isOpen24h: day.isOpen24h,
    opensAt: day.isOpen24h ? null : (day.opensAt ?? null),
    closesAt: day.isOpen24h ? null : (day.closesAt ?? null),
  };
}
