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

// At most this many results inside a radius (the contract of Sprint 2).
export const SEARCH_RESULTS_LIMIT = 50;
// Without a radius (Sprint 4: the app shows every restaurant on the map), a
// cap that only protects the response; the city has far fewer restaurants.
export const SEARCH_ALL_RESULTS_LIMIT = 500;

// What the search needs, already validated by SearchRestaurantsQueryDto:
// lat + lng or zone, never both, or neither; a radius only with one of them.
// The filters are optional.
export interface RestaurantSearchQuery {
  lat?: number;
  lng?: number;
  zone?: ZoneId;
  radiusKm?: number;
  category?: RestaurantCategory;
  partySize?: number;
}

interface PlacedCandidate {
  candidate: RestaurantCandidate;
  // Null without an origin: there is nothing to measure from.
  distanceKm: number | null;
}

function searchCenter(query: RestaurantSearchQuery): GeoPoint | null {
  if (query.zone !== undefined) {
    return zoneCenter(query.zone);
  }
  if (query.lat === undefined || query.lng === undefined) {
    return null;
  }
  return { latitude: query.lat, longitude: query.lng };
}

// Closest first, or by name without an origin; on a tie, by id, so the order
// never depends on the database.
function byDistanceOrName(a: PlacedCandidate, b: PlacedCandidate): number {
  const byDistance =
    a.distanceKm !== null && b.distanceKm !== null
      ? a.distanceKm - b.distanceKm
      : a.candidate.name.localeCompare(b.candidate.name, 'es', {
          sensitivity: 'base',
        });
  return byDistance || a.candidate.id.localeCompare(b.candidate.id);
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
// party size filters (PBI 4.1). Without a radius (Sprint 4) it covers every
// restaurant, measured from the origin when there is one. It combines the SQL prefilter and the
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
    const { radiusKm } = query;
    const filters = { category: query.category };
    const candidates =
      center !== null && radiusKm !== undefined
        ? await this.candidates.findWithin(
            boundingBox(center, radiusKm),
            filters,
          )
        : await this.candidates.findAll(filters);
    const nearby: PlacedCandidate[] = candidates
      .map((candidate) => ({
        candidate,
        distanceKm:
          center === null ? null : haversineKm(center, candidate.location),
      }))
      .filter(
        ({ distanceKm }) =>
          radiusKm === undefined ||
          distanceKm === null ||
          distanceKm <= radiusKm,
      )
      .sort(byDistanceOrName);
    if (nearby.length === 0) {
      return [];
    }
    const limit =
      radiusKm === undefined ? SEARCH_ALL_RESULTS_LIMIT : SEARCH_RESULTS_LIMIT;

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
        distanceKm: distanceKm === null ? null : roundKm(distanceKm),
        availability: level,
      });
      if (results.length === limit) {
        break;
      }
    }
    return results;
  }
}
