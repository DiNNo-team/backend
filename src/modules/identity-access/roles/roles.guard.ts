import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithCurrentUser } from '../current-user/current-user.guard.js';
import { ROLES_METADATA } from './roles.decorator.js';
import type { UserRole } from './user-role.js';

export const ROLE_FORBIDDEN_MESSAGE = 'No tienes acceso a esta sección.';

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

    const { currentUser } = context
      .switchToHttp()
      .getRequest<RequestWithCurrentUser>();
    if (
      !currentUser ||
      !roles.some((allowedRole) => allowedRole === currentUser.role)
    ) {
      throw new ForbiddenException(ROLE_FORBIDDEN_MESSAGE);
    }

    return true;
  }
}