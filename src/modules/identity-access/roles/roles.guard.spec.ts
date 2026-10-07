import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUserData } from '../current-user/current-user-data.js';
import type { RequestWithCurrentUser } from '../current-user/current-user.guard.js';
import { Roles } from './roles.decorator.js';
import { ROLE_FORBIDDEN_MESSAGE, RolesGuard } from './roles.guard.js';
import { UserRole } from './user-role.js';

function contextFor(
  role: string | null,
  requiredRoles?: UserRole[],
): ExecutionContext {
  class TestController {}
  if (requiredRoles !== undefined) {
    Roles(...requiredRoles)(TestController);
  }
  const request = {
    currentUser: {
      userId: 'user-id',
      restaurantId: 'restaurant-id',
      role,
    } as CurrentUserData,
  } as RequestWithCurrentUser;
  return {
    getHandler: () => TestController,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a permitted role', () => {
    expect(
      guard.canActivate(
        contextFor(UserRole.RESTAURANT_ADMIN, [UserRole.RESTAURANT_ADMIN]),
      ),
    ).toBe(true);
  });

  it('rejects a role that is not in the allowed list', () => {
    expect(() =>
      guard.canActivate(contextFor(UserRole.RESTAURANT_ADMIN, [])),
    ).toThrow(new ForbiddenException(ROLE_FORBIDDEN_MESSAGE));
  });

  it('rejects an unknown role', () => {
    expect(() =>
      guard.canActivate(
        contextFor('unknown-role', [UserRole.RESTAURANT_ADMIN]),
      ),
    ).toThrow(new ForbiddenException(ROLE_FORBIDDEN_MESSAGE));
  });

  it('rejects a user without a role', () => {
    expect(() =>
      guard.canActivate(contextFor(null, [UserRole.RESTAURANT_ADMIN])),
    ).toThrow(new ForbiddenException(ROLE_FORBIDDEN_MESSAGE));
  });

  it('allows a request when no role metadata is present', () => {
    expect(guard.canActivate(contextFor(UserRole.RESTAURANT_ADMIN))).toBe(true);
  });
});