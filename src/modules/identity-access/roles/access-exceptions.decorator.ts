import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNAPPROVED_RESTAURANT_METADATA =
  'identity-access:allow-unapproved-restaurant';
export const ALLOW_UNREGISTERED_ACCOUNT_METADATA =
  'identity-access:allow-unregistered-account';

// Explicit and short list of the restaurant routes that a restaurant_admin
// whose restaurant is pending or rejected may still call (CLAUDE.md §11,
// "Aprobación de restaurantes"): GET /v1/me, GET /v1/restaurants/me and
// GET /v1/geocode. Every other @Roles(RESTAURANT_ADMIN) route answers
// ACCOUNT_PENDING_APPROVAL or ACCOUNT_REJECTED. Put it on the handler, never on
// a whole controller, so a new route is blocked by default.
export const AllowUnapprovedRestaurant = () =>
  SetMetadata(ALLOW_UNAPPROVED_RESTAURANT_METADATA, true);

// A route with @Roles that also accepts a Firebase account without a users row
// (verified email, guaranteed by the resolver). Only GET /v1/geocode, which the
// restaurant sign-up form uses before the account exists.
export const AllowUnregisteredAccount = () =>
  SetMetadata(ALLOW_UNREGISTERED_ACCOUNT_METADATA, true);
