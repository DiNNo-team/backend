import type { AvailabilityService } from '../availability/availability.service.js';
import type { AvailabilityResult } from '../availability/availability.types.js';
import { boundingBox, haversineKm, type GeoPoint } from './geo.js';
import type {
  RestaurantCandidate,
  RestaurantCandidatesReader,
} from './restaurant-candidates.reader.js';
import {
  RestaurantSearchService,
  SEARCH_RESULTS_LIMIT,
} from './restaurant-search.service.js';
import { zoneCenter } from './zones.js';

const CENTER: GeoPoint = { latitude: 4.655671, longitude: -74.057006 };
// km per degree of latitude on the sphere of haversineKm.
const KM_PER_DEGREE = (6371.0088 * Math.PI) / 180;

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A restaurant km to the north of from: haversineKm gives exactly km.
function candidate(
  n: number,
  km: number,
  from: GeoPoint = CENTER,
): RestaurantCandidate {
  return {
    id: uuid(n),
    name: `Restaurante ${n}`,
    category: 'colombian',
    address: `Calle ${n}`,
    location: {
      latitude: from.latitude + km / KM_PER_DEGREE,
      longitude: from.longitude,
    },
  };
}

const SEARCHABLE: AvailabilityResult = {
  isOpenNow: true,
  availability: 'available',
  isSearchable: true,
};

// Reader and AvailabilityService stand-ins. By default every candidate is
// searchable and 'available'; overrides change single restaurants.
function setup(
  candidates: RestaurantCandidate[],
  overrides: Record<string, AvailabilityResult> = {},
) {
  const reader = { findWithin: vi.fn().mockResolvedValue(candidates) };
  const availability = {
    getForRestaurants: vi.fn((ids: string[]) =>
      Promise.resolve(
        new Map(ids.map((id) => [id, overrides[id] ?? SEARCHABLE])),
      ),
    ),
  };
  const service = new RestaurantSearchService(
    reader as unknown as RestaurantCandidatesReader,
    availability as unknown as AvailabilityService,
  );
  return { service, reader, availability };
}

const byLocation = (radiusKm = 2) => ({
  lat: CENTER.latitude,
  lng: CENTER.longitude,
  radiusKm,
});

describe('RestaurantSearchService', () => {
  it('reads the candidates inside the rectangle of the radius', async () => {
    const { service, reader } = setup([]);

    await service.search(byLocation(5));

    expect(reader.findWithin).toHaveBeenCalledTimes(1);
    expect(reader.findWithin).toHaveBeenCalledWith(boundingBox(CENTER, 5));
  });

  it('searches around the centre of the zone', async () => {
    const { service, reader } = setup([]);

    await service.search({ zone: 'kennedy', radiusKm: 2 });

    expect(reader.findWithin).toHaveBeenCalledWith(
      boundingBox(zoneCenter('kennedy'), 2),
    );
  });

  it('measures the distance from the centre of the zone', async () => {
    const kennedy = zoneCenter('kennedy');
    const { service } = setup([candidate(1, 0.5, kennedy)]);

    const [result] = await service.search({ zone: 'kennedy', radiusKm: 2 });

    expect(result.distanceKm).toBe(0.5);
  });

  it('leaves out a restaurant in the corner of the rectangle but outside the radius', async () => {
    const box = boundingBox(CENTER, 2);
    const corner: RestaurantCandidate = {
      ...candidate(1, 0),
      location: { latitude: box.maxLat, longitude: box.maxLng },
    };
    expect(haversineKm(CENTER, corner.location)).toBeGreaterThan(2);
    const { service, availability } = setup([corner, candidate(2, 1.9)]);

    const results = await service.search(byLocation(2));

    expect(results.map((r) => r.id)).toEqual([uuid(2)]);
    expect(availability.getForRestaurants).toHaveBeenCalledWith([uuid(2)]);
  });

  // Exactly 2 km is left to floating-point noise; 1 m inside must stay.
  it('keeps a restaurant just inside the edge of the radius', async () => {
    const { service } = setup([candidate(1, 1.999)]);

    const results = await service.search(byLocation(2));

    expect(results.map((r) => r.id)).toEqual([uuid(1)]);
  });

  it('leaves out the restaurants that are not searchable', async () => {
    const { service } = setup(
      [candidate(1, 0.1), candidate(2, 0.2), candidate(3, 0.3)],
      {
        [uuid(1)]: {
          isOpenNow: false,
          availability: 'closed',
          isSearchable: false,
        },
        // Open but without active tables.
        [uuid(2)]: {
          isOpenNow: true,
          availability: 'none',
          isSearchable: false,
        },
      },
    );

    const results = await service.search(byLocation());

    expect(results.map((r) => r.id)).toEqual([uuid(3)]);
  });

  it('leaves out a restaurant the availability does not know', async () => {
    const { service, availability } = setup([candidate(1, 0.1)]);
    availability.getForRestaurants.mockResolvedValue(new Map());

    await expect(service.search(byLocation())).resolves.toEqual([]);
  });

  it('keeps the availability level of each restaurant', async () => {
    const { service } = setup([candidate(1, 0.1), candidate(2, 0.2)], {
      [uuid(1)]: { isOpenNow: true, availability: 'few', isSearchable: true },
      [uuid(2)]: { isOpenNow: true, availability: 'none', isSearchable: true },
    });

    const results = await service.search(byLocation());

    expect(results.map((r) => r.availability)).toEqual(['few', 'none']);
  });

  it('sorts by distance, and by id on the same distance', async () => {
    const { service } = setup([
      candidate(4, 1.5),
      candidate(3, 0.4),
      candidate(9, 0.8),
      candidate(1, 0.8),
    ]);

    const results = await service.search(byLocation());

    expect(results.map((r) => r.id)).toEqual([
      uuid(3),
      uuid(1),
      uuid(9),
      uuid(4),
    ]);
  });

  it(`answers at most ${SEARCH_RESULTS_LIMIT}, the closest ones`, async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      candidate(60 - i, (60 - i) / 100),
    );
    const { service } = setup(many);

    const results = await service.search(byLocation());

    expect(results).toHaveLength(SEARCH_RESULTS_LIMIT);
    expect(results[0].id).toBe(uuid(1));
    expect(results.at(-1)?.id).toBe(uuid(50));
  });

  it('fills the 50 with the next ones when closer ones are not searchable', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      candidate(i + 1, (i + 1) / 100),
    );
    const { service } = setup(many, {
      [uuid(1)]: {
        isOpenNow: false,
        availability: 'closed',
        isSearchable: false,
      },
    });

    const results = await service.search(byLocation());

    expect(results).toHaveLength(SEARCH_RESULTS_LIMIT);
    expect(results[0].id).toBe(uuid(2));
    expect(results.at(-1)?.id).toBe(uuid(51));
  });

  it('asks the availability once, with the ids already filtered by radius', async () => {
    const { service, availability } = setup([
      candidate(2, 0.7),
      candidate(1, 0.3),
      candidate(3, 2.5),
    ]);

    await service.search(byLocation(2));

    expect(availability.getForRestaurants).toHaveBeenCalledTimes(1);
    expect(availability.getForRestaurants).toHaveBeenCalledWith([
      uuid(1),
      uuid(2),
    ]);
  });

  it('does not ask the availability without candidates in the radius', async () => {
    const { service, availability } = setup([candidate(1, 3)]);

    await expect(service.search(byLocation(2))).resolves.toEqual([]);
    expect(availability.getForRestaurants).not.toHaveBeenCalled();
  });

  it('answers the contract shape, distance with 2 decimals and no counts', async () => {
    const { service } = setup([candidate(1, 0.654321)]);

    const [result] = await service.search(byLocation());

    expect(result).toStrictEqual({
      id: uuid(1),
      name: 'Restaurante 1',
      category: 'colombian',
      address: 'Calle 1',
      latitude: candidate(1, 0.654321).location.latitude,
      longitude: CENTER.longitude,
      distanceKm: 0.65,
      availability: 'available',
    });
  });

  it('filters by the exact distance, not the rounded one', async () => {
    // 2.004 km rounds to 2.00 but is outside a 2 km radius.
    const { service } = setup([candidate(1, 2.004)]);

    await expect(service.search(byLocation(2))).resolves.toEqual([]);
  });
});
