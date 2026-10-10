import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { requireRestaurant } from '../shared/restaurant-required.js';
import type { RestaurantFieldsDto } from './dto/restaurant-fields.dto.js';
import type { UpdateRestaurantDto } from './dto/update-restaurant.dto.js';
import type { RestaurantProfile } from './restaurant-registration.service.js';
import { toScheduleRow } from './restaurant-schedule-rows.js';
import { RestaurantSchedule } from './restaurant-schedule.entity.js';
import { Restaurant } from './restaurant.entity.js';

export const NO_CHANGES_MESSAGE =
  'No hay cambios para guardar. Cambia al menos un dato del restaurante.';

// Editing the restaurant data (PBI 4). Registration (PBI 3) lives in its own
// files; both share the field rules in dto/restaurant-fields.dto.ts and the
// opening hours rules in dto/restaurant-schedule.dto.ts.
@Injectable()
export class RestaurantEditService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
  ) {}

  // Fields and opening hours change in one transaction: if replacing the
  // hours fails, the fields are rolled back too.
  async update(
    restaurantId: string | null,
    dto: UpdateRestaurantDto,
  ): Promise<RestaurantProfile> {
    const ownerId = requireRestaurant(restaurantId);
    const { schedules, ...fields } = dto;
    const changes = sentFields(fields);
    const hasFieldChanges = Object.keys(changes).length > 0;
    // A list, like the other validation 400s.
    if (!hasFieldChanges && schedules === undefined) {
      throw new BadRequestException([NO_CHANGES_MESSAGE]);
    }

    return this.restaurants.manager.transaction(async (manager) => {
      // Row lock: concurrent edits queue up, so two schedule replacements
      // never collide on the unique (restaurant, day) index.
      const restaurant = await manager.findOne(Restaurant, {
        where: { id: ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!restaurant) {
        // users.restaurant_id has a foreign key to restaurants, so this cannot happen
        // with valid data: let the global filter log it and answer the generic 500.
        throw new Error(`Restaurant ${ownerId} of the session user not found`);
      }

      // id last: whatever the changes carry, the session restaurant is updated.
      const saved = hasFieldChanges
        ? await manager.save(
            manager.merge<Restaurant>(Restaurant, restaurant, changes, {
              id: ownerId,
            }),
          )
        : restaurant;

      if (schedules === undefined) {
        const stored = await manager.find(RestaurantSchedule, {
          where: { restaurantId: ownerId },
          order: { dayOfWeek: 'ASC' },
        });
        return { restaurant: saved, schedules: stored };
      }

      // Full replacement, always of the session restaurant's rows.
      await manager.delete(RestaurantSchedule, { restaurantId: ownerId });
      const replaced = await manager.save(
        schedules.map((day) =>
          manager.create(RestaurantSchedule, toScheduleRow(ownerId, day)),
        ),
      );
      return { restaurant: saved, schedules: replaced };
    });
  }
}

// Each DTO field is copied to the entity property with the same name.
// Pick fails to compile if RestaurantFieldsDto gets a field the entity lacks.
type RestaurantChanges = Partial<Pick<Restaurant, keyof RestaurantFieldsDto>>;

// Only the fields the client sent: a PATCH leaves the rest untouched. Generic
// on purpose, so fields added to RestaurantFieldsDto need no change here.
function sentFields(
  fields: Omit<UpdateRestaurantDto, 'schedules'>,
): RestaurantChanges {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}
