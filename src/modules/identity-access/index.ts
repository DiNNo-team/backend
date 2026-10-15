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
export { UserRole } from './roles/user-role.js';
export { SESSION_UNAUTHORIZED_RESPONSE } from './auth/auth-errors.js';
export {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_ERROR_MESSAGES,
  DINER_ENDPOINT_ACCOUNT_EXAMPLES,
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  type AccountErrorCode,
} from './roles/account-errors.js';
export { UsersService } from './users/users.service.js';
