import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RESTAURANT_AVAILABILITY_AFFECTED,
  type RestaurantAvailabilityAffectedEvent,
} from '../../restaurant-operations/index.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { AvailabilityGateway } from './availability.gateway.js';

// Recalculates the availability of a restaurant that changed and hands it to
// the gateway. async: true runs it outside the request that made the change,
// so nothing here can slow down or fail that HTTP response.
@Injectable()
export class AvailabilityChangedListener {
  private readonly logger = new Logger(AvailabilityChangedListener.name);

  constructor(
    private readonly availability: AvailabilityService,
    private readonly gateway: AvailabilityGateway,
  ) {}

  @OnEvent(RESTAURANT_AVAILABILITY_AFFECTED, { async: true })
  async handle({
    restaurantId,
  }: RestaurantAvailabilityAffectedEvent): Promise<void> {
    try {
      const result = await this.availability.getForRestaurant(restaurantId);
      if (result === null) {
        return;
      }
      this.gateway.broadcast({
        restaurantId,
        availability: result.availability,
        isOpenNow: result.isOpenNow,
        isSearchable: result.isSearchable,
      });
    } catch (error) {
      // The app recovers by polling; only the id and the error type are logged.
      this.logger.warn(
        `Could not send availability.changed for restaurant ${restaurantId}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
}
