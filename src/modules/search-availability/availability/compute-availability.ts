import type {
  AvailabilityResult,
  RestaurantSnapshot,
} from './availability.types.js';
import { isOpenNow } from './opening-hours.js';
import { availabilityLevel, hasActiveTable } from './table-availability.js';

// The whole rule for one restaurant at one instant. The result carries only
// what the contract allows to show: never how many tables there are or how
// many are free.
export function computeAvailability(
  snapshot: RestaurantSnapshot,
  instant: Date,
): AvailabilityResult {
  const openNow = isOpenNow(snapshot, instant);
  return {
    isOpenNow: openNow,
    availability: openNow ? availabilityLevel(snapshot.tables) : 'closed',
    isSearchable:
      snapshot.hasLocation && openNow && hasActiveTable(snapshot.tables),
  };
}
