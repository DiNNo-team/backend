import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithCurrentUser } from '../current-user/current-user.guard.js';
import { accountForbidden } from './account-errors.js';
import { ROLES_METADATA } from './roles.decorator.js';
import { UserRole } from './user-role.js';

export const ROLE_FORBIDDEN_MESSAGE = 'No tienes acceso a esta sección.';

// Runs after CurrentUserGuard. Each rejection carries the errorCode of the
// Sprint 2 contract ("Códigos de cuenta"), chosen by the roles the route
// accepts. The generic 403 without errorCode is only for a route whose
// CurrentUserGuard did not run.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (roles === undefined) {
      return true;
    }

    const { identity } = context
      .switchToHttp()
      .getRequest<RequestWithCurrentUser>();
    if (!identity) {
      throw new ForbiddenException(ROLE_FORBIDDEN_MESSAGE);
    }

    // A Firebase account with no users row: the app creates the diner
    // profile on PROFILE_REQUIRED; the web shows ACCOUNT_NOT_ENABLED.
    if (identity.kind === 'unregistered') {
      throw accountForbidden(
        roles.includes(UserRole.DINER)
          ? 'PROFILE_REQUIRED'
          : 'ACCOUNT_NOT_ENABLED',
      );
    }

    const { role } = identity.user;
    if (roles.includes(role)) {
      return true;
    }
    throw accountForbidden(
      role === UserRole.DINER ? 'DINER_ACCOUNT' : 'RESTAURANT_ACCOUNT',
    );
  }
}
