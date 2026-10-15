import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestIdentity } from '../current-user/current-user-data.js';
import type { RequestWithCurrentUser } from '../current-user/current-user.guard.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  type AccountErrorCode,
} from './account-errors.js';
import { Roles } from './roles.decorator.js';
import { ROLE_FORBIDDEN_MESSAGE, RolesGuard } from './roles.guard.js';
import { UserRole } from './user-role.js';

const UNREGISTERED: RequestIdentity = {
  kind: 'unregistered',
  firebase: {
    uid: 'firebase-uid',
    email: 'ana@example.com',
    name: null,
    emailVerified: true,
  },
};

function registered(role: UserRole): RequestIdentity {
  return {
    kind: 'registered',
    user: { userId: 'user-id', restaurantId: null, role },
  };
}

function contextFor(
  identity: RequestIdentity | undefined,
  requiredRoles?: UserRole[],
): ExecutionContext {
  class TestController {}
  if (requiredRoles !== undefined) {
    Roles(...requiredRoles)(TestController);
  }
  const request = { identity } as RequestWithCurrentUser;
  return {
    getHandler: () => TestController,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

// The guard's 403, or true when it lets the request through.
function outcome(
  identity: RequestIdentity | undefined,
  requiredRoles?: UserRole[],
): ForbiddenException | true {
  const guard = new RolesGuard(new Reflector());
  try {
    return guard.canActivate(contextFor(identity, requiredRoles)) as true;
  } catch (error) {
    if (!(error instanceof ForbiddenException)) {
      throw error;
    }
    return error;
  }
}

function accountError(code: AccountErrorCode) {
  return {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  };
}

const RESTAURANT_ENDPOINT = [UserRole.RESTAURANT_ADMIN];
const DINER_ENDPOINT = [UserRole.DINER];
const BOTH_ROLES_ENDPOINT = [UserRole.RESTAURANT_ADMIN, UserRole.DINER];

describe('RolesGuard', () => {
  // Contract table "Códigos de cuenta": identity × endpoint type.
  it.each<[string, RequestIdentity, UserRole[], AccountErrorCode | 'allowed']>([
    ['no profile', UNREGISTERED, RESTAURANT_ENDPOINT, 'ACCOUNT_NOT_ENABLED'],
    ['no profile', UNREGISTERED, DINER_ENDPOINT, 'PROFILE_REQUIRED'],
    ['no profile', UNREGISTERED, BOTH_ROLES_ENDPOINT, 'PROFILE_REQUIRED'],
    [
      'a diner',
      registered(UserRole.DINER),
      RESTAURANT_ENDPOINT,
      'DINER_ACCOUNT',
    ],
    ['a diner', registered(UserRole.DINER), DINER_ENDPOINT, 'allowed'],
    ['a diner', registered(UserRole.DINER), BOTH_ROLES_ENDPOINT, 'allowed'],
    [
      'a restaurant',
      registered(UserRole.RESTAURANT_ADMIN),
      RESTAURANT_ENDPOINT,
      'allowed',
    ],
    [
      'a restaurant',
      registered(UserRole.RESTAURANT_ADMIN),
      DINER_ENDPOINT,
      'RESTAURANT_ACCOUNT',
    ],
    [
      'a restaurant',
      registered(UserRole.RESTAURANT_ADMIN),
      BOTH_ROLES_ENDPOINT,
      'allowed',
    ],
  ])('%s on an endpoint for %j → %s', (_who, identity, roles, expected) => {
    const result = outcome(identity, roles);

    if (expected === 'allowed') {
      expect(result).toBe(true);
    } else {
      expect(result).toBeInstanceOf(ForbiddenException);
      expect((result as ForbiddenException).getResponse()).toEqual(
        accountError(expected),
      );
    }
  });

  it('rejects with the generic 403 when CurrentUserGuard did not run', () => {
    const result = outcome(undefined, RESTAURANT_ENDPOINT);

    expect((result as ForbiddenException).getResponse()).toEqual({
      statusCode: 403,
      message: ROLE_FORBIDDEN_MESSAGE,
      error: 'Forbidden',
    });
  });

  it('allows any identity when no role metadata is present', () => {
    expect(outcome(UNREGISTERED)).toBe(true);
    expect(outcome(registered(UserRole.DINER))).toBe(true);
  });
});
