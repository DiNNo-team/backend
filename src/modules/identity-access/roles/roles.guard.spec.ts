import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestIdentity } from '../current-user/current-user-data.js';
import type { RequestWithCurrentUser } from '../current-user/current-user.guard.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  type AccountErrorCode,
} from './account-errors.js';
import type { RestaurantApprovalStatus } from '../approval/restaurant-approval-status.js';
import {
  AllowUnapprovedRestaurant,
  AllowUnregisteredAccount,
} from './access-exceptions.decorator.js';
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
    user: {
      userId: 'user-id',
      restaurantId: null,
      role,
      restaurantApproval: null,
    },
  };
}

interface RouteExceptions {
  unapproved?: boolean;
  unregistered?: boolean;
}

function contextFor(
  identity: RequestIdentity | undefined,
  requiredRoles?: UserRole[],
  exceptions: RouteExceptions = {},
): ExecutionContext {
  class TestController {}
  if (requiredRoles !== undefined) {
    Roles(...requiredRoles)(TestController);
  }
  if (exceptions.unapproved) {
    AllowUnapprovedRestaurant()(TestController);
  }
  if (exceptions.unregistered) {
    AllowUnregisteredAccount()(TestController);
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
  exceptions: RouteExceptions = {},
): ForbiddenException | true {
  const guard = new RolesGuard(new Reflector());
  try {
    return guard.canActivate(
      contextFor(identity, requiredRoles, exceptions),
    ) as true;
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

// A restaurant_admin with a restaurant in the given approval status.
function owner(approval: RestaurantApprovalStatus): RequestIdentity {
  return {
    kind: 'registered',
    user: {
      userId: 'user-id',
      restaurantId: 'restaurant-id',
      role: UserRole.RESTAURANT_ADMIN,
      restaurantApproval: approval,
    },
  };
}

const RESTAURANT_ENDPOINT = [UserRole.RESTAURANT_ADMIN];
const ADMIN_ENDPOINT = [UserRole.PLATFORM_ADMIN];
const ALL_ROLES_ENDPOINT = [
  UserRole.RESTAURANT_ADMIN,
  UserRole.DINER,
  UserRole.PLATFORM_ADMIN,
];
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

  // §11 "Aprobación de restaurantes": the platform_admin and the wrong role.
  it.each<[string, RequestIdentity, UserRole[], AccountErrorCode | 'allowed']>([
    [
      'a DiNNo admin',
      registered(UserRole.PLATFORM_ADMIN),
      RESTAURANT_ENDPOINT,
      'ADMIN_ACCOUNT',
    ],
    [
      'a DiNNo admin',
      registered(UserRole.PLATFORM_ADMIN),
      DINER_ENDPOINT,
      'ADMIN_ACCOUNT',
    ],
    [
      'a DiNNo admin',
      registered(UserRole.PLATFORM_ADMIN),
      BOTH_ROLES_ENDPOINT,
      'ADMIN_ACCOUNT',
    ],
    [
      'a DiNNo admin',
      registered(UserRole.PLATFORM_ADMIN),
      ADMIN_ENDPOINT,
      'allowed',
    ],
    [
      'a DiNNo admin',
      registered(UserRole.PLATFORM_ADMIN),
      ALL_ROLES_ENDPOINT,
      'allowed',
    ],
    [
      'a restaurant',
      registered(UserRole.RESTAURANT_ADMIN),
      ADMIN_ENDPOINT,
      'RESTAURANT_ACCOUNT',
    ],
    [
      'an approved restaurant',
      owner('approved'),
      ADMIN_ENDPOINT,
      'RESTAURANT_ACCOUNT',
    ],
    [
      'a pending restaurant',
      owner('pending'),
      ADMIN_ENDPOINT,
      'RESTAURANT_ACCOUNT',
    ],
    ['a diner', registered(UserRole.DINER), ADMIN_ENDPOINT, 'DINER_ACCOUNT'],
    ['no profile', UNREGISTERED, ADMIN_ENDPOINT, 'ACCOUNT_NOT_ENABLED'],
  ])('%s on an endpoint for %j → %s', (_who, identity, roles, expected) => {
    expectOutcome(outcome(identity, roles), expected);
  });

  // Approval × route: every combination of status and allow-list.
  describe('restaurant approval', () => {
    it.each<[RestaurantApprovalStatus, boolean, AccountErrorCode | 'allowed']>([
      ['approved', false, 'allowed'],
      ['approved', true, 'allowed'],
      ['pending', false, 'ACCOUNT_PENDING_APPROVAL'],
      ['pending', true, 'allowed'],
      ['rejected', false, 'ACCOUNT_REJECTED'],
      ['rejected', true, 'allowed'],
    ])(
      'a %s restaurant on a restaurant route (allow-listed: %s) → %s',
      (approval, allowListed, expected) => {
        expectOutcome(
          outcome(owner(approval), RESTAURANT_ENDPOINT, {
            unapproved: allowListed,
          }),
          expected,
        );
      },
    );

    it.each<[RestaurantApprovalStatus, AccountErrorCode]>([
      ['approved', 'RESTAURANT_ACCOUNT'],
      ['pending', 'RESTAURANT_ACCOUNT'],
      ['rejected', 'RESTAURANT_ACCOUNT'],
    ])(
      'a %s restaurant on a diner route gets the role code first: %s',
      (approval, expected) => {
        // Even allow-listed: the role check goes before the approval.
        expectOutcome(
          outcome(owner(approval), DINER_ENDPOINT, { unapproved: true }),
          expected,
        );
      },
    );

    it('a pending restaurant on a route of both roles is still blocked unless allow-listed', () => {
      expectOutcome(
        outcome(owner('pending'), BOTH_ROLES_ENDPOINT),
        'ACCOUNT_PENDING_APPROVAL',
      );
      expectOutcome(
        outcome(owner('pending'), BOTH_ROLES_ENDPOINT, { unapproved: true }),
        'allowed',
      );
    });

    it('a restaurant_admin without a restaurant passes: RESTAURANT_REQUIRED comes later', () => {
      expectOutcome(
        outcome(registered(UserRole.RESTAURANT_ADMIN), RESTAURANT_ENDPOINT),
        'allowed',
      );
    });

    it('the allow-list never lets a diner or a DiNNo admin into a restaurant route', () => {
      expectOutcome(
        outcome(registered(UserRole.DINER), RESTAURANT_ENDPOINT, {
          unapproved: true,
        }),
        'DINER_ACCOUNT',
      );
      expectOutcome(
        outcome(registered(UserRole.PLATFORM_ADMIN), RESTAURANT_ENDPOINT, {
          unapproved: true,
        }),
        'ADMIN_ACCOUNT',
      );
    });
  });

  describe('accounts without profile (@AllowUnregisteredAccount)', () => {
    it('lets a verified account without profile through when the route allows it', () => {
      expectOutcome(
        outcome(UNREGISTERED, BOTH_ROLES_ENDPOINT, { unregistered: true }),
        'allowed',
      );
    });

    it('never lets an unverified account through, even if the route allows it', () => {
      const unverified: RequestIdentity = {
        kind: 'unregistered',
        firebase: {
          uid: 'firebase-uid',
          email: 'ana@example.com',
          name: null,
          emailVerified: false,
        },
      };

      expectOutcome(
        outcome(unverified, BOTH_ROLES_ENDPOINT, { unregistered: true }),
        'PROFILE_REQUIRED',
      );
    });

    it('does not change the role checks of registered accounts', () => {
      expectOutcome(
        outcome(registered(UserRole.PLATFORM_ADMIN), BOTH_ROLES_ENDPOINT, {
          unregistered: true,
          unapproved: true,
        }),
        'ADMIN_ACCOUNT',
      );
    });
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

function expectOutcome(
  result: ForbiddenException | true,
  expected: AccountErrorCode | 'allowed',
): void {
  if (expected === 'allowed') {
    expect(result).toBe(true);
  } else {
    expect(result).toBeInstanceOf(ForbiddenException);
    expect((result as ForbiddenException).getResponse()).toEqual(
      accountError(expected),
    );
  }
}
