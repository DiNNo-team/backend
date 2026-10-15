import { Injectable } from '@nestjs/common';
import { AvailabilityService } from '../availability/availability.service.js';
import { haversineKm, roundKm, type GeoPoint } from '../search/geo.js';
import type { PublicRestaurantResponseDto } from './dto/public-restaurant.dto.js';
import { PublicRestaurantReader } from './public-restaurant.reader.js';
import { restaurantNotFound } from './restaurant-not-found.js';

// Public detail of a restaurant (PBI 3.2). It combines the profile
// (PublicRestaurantReader), the availability (AvailabilityService) and the
// distance (geo.ts), without repeating any of their rules.
@Injectable()
export class PublicRestaurantService {
  constructor(
    private readonly reader: PublicRestaurantReader,
    private readonly availability: AvailabilityService,
  ) {}

  // id: a valid UUID. origin: the diner's location, when sent.
  async getById(
    id: string,
    origin?: GeoPoint,
  ): Promise<PublicRestaurantResponseDto> {
    const [profile, availability] = await Promise.all([
      this.reader.findProfile(id),
      this.availability.getForRestaurant(id),
    ]);
    // Without coordinates it cannot be in the search nor on the map: for the
    // app it does not exist.
    const location = profile?.location;
    if (!profile || !location || !availability) {
      throw restaurantNotFound();
    }
    return {
      id: profile.id,
      name: profile.name,
      category: profile.category,
      address: profile.address,
      latitude: location.latitude,
      longitude: location.longitude,
      schedules: profile.schedules,
      isOpenNow: availability.isOpenNow,
      availability: availability.availability,
      ...(origin && { distanceKm: roundKm(haversineKm(origin, location)) }),
    };
  }
}
