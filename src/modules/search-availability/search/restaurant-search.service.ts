import { Injectable } from '@nestjs/common';
import {
  AvailabilityService,
  type GetForRestaurantsOptions,
} from '../availability/availability.service.js';
import type {
  AvailabilityLevel,
  AvailabilityResult,
} from '../availability/availability.types.js';
import type { SearchResultDto } from './dto/search-responses.dto.js';
import { boundingBox, haversineKm, roundKm, type GeoPoint } from './geo.js';
import {
  RestaurantCandidatesReader,
  type RestaurantCandidate,
} from './restaurant-candidates.reader.js';
import { zoneCenter, type ZoneId } from './zones.js';
import type { RestaurantCategory } from '../../restaurant-operations/index.js';

export const SEARCH_RESULTS_LIMIT = 50;

// What the search needs, already validated by SearchRestaurantsQueryDto:
// lat + lng or zone, never both; the filters are optional.
export interface RestaurantSearchQuery {
  lat?: number;
  lng?: number;
  zone?: ZoneId;
  radiusKm: number;
  category?: RestaurantCategory;
  partySize?: number;
}

interface NearbyCandidate {
  candidate: RestaurantCandidate;
  distanceKm: number;
}

function searchCenter(query: RestaurantSearchQuery): GeoPoint {
  if (query.zone !== undefined) {
    return zoneCenter(query.zone);
  }
  if (query.lat === undefined || query.lng === undefined) {
    // Unreachable: the query DTO rejects a search without an origin.
    throw new Error('Search without lat/lng or zone');
  }
  return { latitude: query.lat, longitude: query.lng };
}

// Closest first; same distance, by id, so the order never depends on the
// database.
function byDistanceThenId(a: NearbyCandidate, b: NearbyCandidate): number {
  return (
    a.distanceKm - b.distanceKm || a.candidate.id.localeCompare(b.candidate.id)
  );
}

// Only the options the diner sent: without partySize, no table filter.
function availabilityOptions(
  query: RestaurantSearchQuery,
): GetForRestaurantsOptions {
  return query.partySize === undefined ? {} : { partySize: query.partySize };
}

// A searchable restaurant is always open now, so its level is never
// 'closed'; null when it must not appear in the search.
function searchableLevel(
  result: AvailabilityResult | undefined,
): AvailabilityLevel | null {
  if (!result?.isSearchable || result.availability === 'closed') {
    return null;
  }
  return result.availability;
}

// Diner search by location or zone (PBI 2.1 and 2.2) with the category and
// party size filters (PBI 4.1). It combines the SQL prefilter and the
// category (RestaurantCandidatesReader), the exact distance (geo.ts) and the
// availability rule, party size included (AvailabilityService), without
// repeating any of them.
@Injectable()
export class RestaurantSearchService {
  constructor(
    private readonly candidates: RestaurantCandidatesReader,
    private readonly availability: AvailabilityService,
  ) {}

  async search(query: RestaurantSearchQuery): Promise<SearchResultDto[]> {
    const center = searchCenter(query);
    const nearby = (
      await this.candidates.findWithin(boundingBox(center, query.radiusKm), {
        category: query.category,
      })
    )
      .map((candidate) => ({
        candidate,
        distanceKm: haversineKm(center, candidate.location),
      }))
      .filter(({ distanceKm }) => distanceKm <= query.radiusKm)
      .sort(byDistanceThenId);
    if (nearby.length === 0) {
      return [];
    }

    const availability = await this.availability.getForRestaurants(
      nearby.map(({ candidate }) => candidate.id),
      availabilityOptions(query),
    );
    const results: SearchResultDto[] = [];
    for (const { candidate, distanceKm } of nearby) {
      const level = searchableLevel(availability.get(candidate.id));
      if (level === null) {
        continue;
      }
      results.push({
        id: candidate.id,
        name: candidate.name,
        category: candidate.category,
        address: candidate.address,
        latitude: candidate.location.latitude,
        longitude: candidate.location.longitude,
        distanceKm: roundKm(distanceKm),
        availability: level,
      });
      if (results.length === SEARCH_RESULTS_LIMIT) {
        break;
      }
    }
    return results;
  }
}
