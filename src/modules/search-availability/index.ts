// Public surface of search-availability: other modules import only from here.
export { SearchAvailabilityModule } from './search-availability.module.js';
export {
  AvailabilityService,
  type GetForRestaurantsOptions,
} from './availability/availability.service.js';
// To fix the time in the tests: .overrideProvider(Clock).useValue(...).
export { Clock } from './availability/clock.js';
export type {
  Availability,
  AvailabilityLevel,
  AvailabilityResult,
} from './availability/availability.types.js';
