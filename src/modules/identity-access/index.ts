// Public surface of identity-access: other modules import only from here.
export { IdentityAccessModule } from './identity-access.module.js';
export { CurrentUser } from './current-user/current-user.decorator.js';
export { CurrentUserGuard } from './current-user/current-user.guard.js';
export type { CurrentUserData } from './current-user/current-user-data.js';
export { Roles } from './roles/roles.decorator.js';
export { UserRole } from './roles/user-role.js';
export { UsersService } from './users/users.service.js';
