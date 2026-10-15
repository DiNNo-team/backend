import { Injectable } from '@nestjs/common';
import { Between, DataSource } from 'typeorm';
import type { RestaurantCategory } from '../../restaurant-operations/index.js';
import type { BoundingBox, GeoPoint } from './geo.js';

// A restaurant inside the search rectangle, before the exact distance and the
// availability are known.
export interface RestaurantCandidate {
  id: string;
  name: string;
  category: RestaurantCategory | null;
  address: string | null;
  location: GeoPoint;
}

// Columns read from the Restaurant entity of restaurant-operations (by entity
// name, read only). latitude and longitude are numeric(9,6): pg returns them
// as text, and the entity transformer turns them into numbers.
export interface CandidateRow {
  id: string;
  name: string;
  category: RestaurantCategory | null;
  address: string | null;
  latitude: number | string;
  longitude: number | string;
}

export function toCandidate(row: CandidateRow): RestaurantCandidate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    location: {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    },
  };
}

// The SQL side of the search: one read-only query with the cheap rectangle
// prefilter. A restaurant without coordinates never matches BETWEEN (NULL),
// so it is left out here. The exact distance is not its job (geo.ts).
@Injectable()
export class RestaurantCandidatesReader {
  constructor(private readonly dataSource: DataSource) {}

  async findWithin(box: BoundingBox): Promise<RestaurantCandidate[]> {
    const rows = await this.dataSource
      .getRepository<CandidateRow>('Restaurant')
      .find({
        where: {
          latitude: Between(box.minLat, box.maxLat),
          longitude: Between(box.minLng, box.maxLng),
        },
        select: {
          id: true,
          name: true,
          category: true,
          address: true,
          latitude: true,
          longitude: true,
        },
      });
    return rows.map(toCandidate);
  }
}
