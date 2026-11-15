import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { unapprovedCode } from '../approval/unapproved-code.js';
import type { RequestIdentity } from '../current-user/current-user-data.js';
import type { RequestWithCurrentUser } from '../current-user/current-user.guard.js';
import { accountForbidden, type AccountErrorCode } from './account-errors.js';
import {
  ALLOW_UNAPPROVED_RESTAURANT_METADATA,
  ALLOW_UNREGISTERED_ACCOUNT_METADATA,
} from './access-exceptions.decorator.js';
import { ROLES_METADATA } from './roles.decorator.js';
import { UserRole } from './user-role.js';

export const ROLE_FORBIDDEN_MESSAGE = 'No tienes acceso a esta sección.';

// The code a registered account gets on a route that does not accept its role.
const WRONG_ROLE_CODE: Record<UserRole, AccountErrorCode> = {
  [UserRole.DINER]: 'DINER_ACCOUNT',
  [UserRole.RESTAURANT_ADMIN]: 'RESTAURANT_ACCOUNT',
  [UserRole.PLATFORM_ADMIN]: 'ADMIN_ACCOUNT',
};

// Runs after CurrentUserGuard (which already answered the 401s). Precedence of
// its 403s (CLAUDE.md §11, "Aprobación de restaurantes"):
//   1. account without profile → PROFILE_REQUIRED (route accepts diner) or
//      ACCOUNT_NOT_ENABLED, unless the route allows it (@AllowUnregisteredAccount);
//   2. role the route does not accept → DINER_ACCOUNT, RESTAURANT_ACCOUNT or
//      ADMIN_ACCOUNT, by the caller's role;
//   3. restaurant_admin whose restaurant is pending or rejected → the approval
//      code, unless the route is in the list (@AllowUnapprovedRestaurant).
// A restaurant_admin without a restaurant passes: requireRestaurant answers
// RESTAURANT_REQUIRED later, as before. The generic 403 without errorCode is
// only for a route whose CurrentUserGuard did not run.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.metadata<UserRole[]>(context, ROLES_METADATA);
    if (roles === undefined) {
      return true;
    }

    const { identity } = context
      .switchToHttp()
      .getRequest<RequestWithCurrentUser>();
    if (!identity) {
      throw new ForbiddenException(ROLE_FORBIDDEN_MESSAGE);
    }

    if (identity.kind === 'unregistered') {
      return this.checkUnregistered(context, identity, roles);
    }

    const { user } = identity;
    if (!roles.includes(user.role)) {
      throw accountForbidden(WRONG_ROLE_CODE[user.role]);
    }
    const approvalCode = unapprovedCode(user);
    if (
      approvalCode !== null &&
      !this.metadata<boolean>(context, ALLOW_UNAPPROVED_RESTAURANT_METADATA)
    ) {
      throw accountForbidden(approvalCode);
    }
    return true;
  }

  // A Firebase account with no users row: the app creates the diner profile on
  // PROFILE_REQUIRED; the web shows ACCOUNT_NOT_ENABLED.
  private checkUnregistered(
    context: ExecutionContext,
    identity: Extract<RequestIdentity, { kind: 'unregistered' }>,
    roles: UserRole[],
  ): true {
    if (
      identity.firebase.emailVerified &&
      this.metadata<boolean>(context, ALLOW_UNREGISTERED_ACCOUNT_METADATA)
    ) {
      return true;
    }
    throw accountForbidden(
      roles.includes(UserRole.DINER)
        ? 'PROFILE_REQUIRED'
        : 'ACCOUNT_NOT_ENABLED',
    );
  }

  private metadata<T>(context: ExecutionContext, key: string): T | undefined {
    return this.reflector.getAllAndOverride<T | undefined>(key, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
