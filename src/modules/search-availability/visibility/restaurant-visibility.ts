import {
  APPROVED,
  type RestaurantApprovalStatus,
} from '../../identity-access/index.js';

// The column the visibility rule reads from the Restaurant entity (by entity
// name, read only). Readers type their repository as Row & VisibilityColumns.
export interface VisibilityColumns {
  approvalStatus: RestaurantApprovalStatus;
}

// The one rule of "a diner may see this restaurant" that depends on DiNNo's
// approval (CLAUDE.md §11, "Aprobación de restaurantes"): only an approved
// restaurant. Pending and rejected ones do not exist for the diner: not in the
// search, not in the public detail (404), not reservable (404) and without
// availability.changed. As a where fragment, so every query applies it in SQL:
//   repository.find({ where: { id, ...DINER_VISIBLE_RESTAURANT } })
// Used by AvailabilityService, RestaurantCandidatesReader,
// PublicRestaurantReader and CreateReservationService; never repeat the value.
export const DINER_VISIBLE_RESTAURANT: Readonly<VisibilityColumns> =
  Object.freeze({ approvalStatus: APPROVED });

// The same rule for a value already read.
export function isVisibleToDiners(status: RestaurantApprovalStatus): boolean {
  return status === DINER_VISIBLE_RESTAURANT.approvalStatus;
}
