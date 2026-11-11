// Public surface of identity-access: other modules import only from here.
export { IdentityAccessModule } from './identity-access.module.js';
export {
  CurrentIdentity,
  CurrentUser,
} from './current-user/current-user.decorator.js';
export { CurrentUserGuard } from './current-user/current-user.guard.js';
export { isDeployedEnvironment } from './auth/deployed-environment.js';
export type {
  CurrentUserData,
  FirebaseIdentityData,
  RequestIdentity,
} from './current-user/current-user-data.js';
export { Roles } from './roles/roles.decorator.js';
// Exceptions to RolesGuard, route by route (§11 "Aprobación de restaurantes").
export {
  AllowUnapprovedRestaurant,
  AllowUnregisteredAccount,
} from './roles/access-exceptions.decorator.js';
// Approval of a restaurant (restaurants.approval_status): the values, and the
// reader the e2e tests replace.
export {
  APPROVED,
  PENDING,
  REJECTED,
  RESTAURANT_APPROVAL_STATUSES,
  type RestaurantApprovalStatus,
} from './approval/restaurant-approval-status.js';
export { RestaurantApprovalReader } from './approval/restaurant-approval.reader.js';
export { UserRole } from './roles/user-role.js';
export { SESSION_UNAUTHORIZED_RESPONSE } from './auth/auth-errors.js';
export {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_ERROR_MESSAGES,
  accountForbidden,
  DINER_ENDPOINT_ACCOUNT_EXAMPLES,
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  type AccountErrorCode,
} from './roles/account-errors.js';
export { UsersService } from './users/users.service.js';
// The 401 of the session, for the restaurant sign-up (an email already linked
// to another Firebase account answers like the login).
export { emailNotVerified, sessionExpired } from './auth/auth-errors.js';
// WebSocket handshake of diners and restaurants (real time).
export {
  SocketAuthenticator,
  SocketRejection,
  SOCKET_REJECTION_CODES,
  type SocketRejectionCode,
} from './realtime/socket-authenticator.js';
