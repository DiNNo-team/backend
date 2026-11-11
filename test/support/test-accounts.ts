import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  type RestaurantApprovalStatus,
  UserRole,
} from './../../src/modules/identity-access/index.js';
import type { User } from './../../src/modules/identity-access/users/user.entity.js';

// The three accounts of the diner endpoints' e2e tests, by Firebase token:
// a diner, a restaurant and a Firebase account without a users row.
// Use them with .overrideProvider(FIREBASE_AUTH).useValue(() => fakeFirebaseAuth)
// and .overrideProvider(getRepositoryToken(User)).useValue(usersRepository(...)).
export const TEST_TOKENS: Record<string, Partial<DecodedIdToken>> = {
  diner: { uid: 'uid-diner', email: 'diner@example.com' },
  owner: { uid: 'uid-owner', email: 'owner@example.com' },
  // A Firebase account without a users row.
  noProfile: { uid: 'uid-new', email: 'nueva@example.com' },
  // Restaurant approval (CLAUDE.md §11): see approvalTestUsers().
  pendingOwner: { uid: 'uid-pending', email: 'pendiente@example.com' },
  rejectedOwner: { uid: 'uid-rejected', email: 'rechazado@example.com' },
  platformAdmin: { uid: 'uid-admin', email: 'admin@example.com' },
};

// Restaurants of approvalTestUsers(), and the approval of each one: pass
// TEST_APPROVALS (plus the ids of the test's own approved restaurants) to
// approvalReader.
export const PENDING_RESTAURANT_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';
export const REJECTED_RESTAURANT_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70';
export const TEST_APPROVALS: Record<string, RestaurantApprovalStatus> = {
  [PENDING_RESTAURANT_ID]: 'pending',
  [REJECTED_RESTAURANT_ID]: 'rejected',
};

// The users rows of the owners of a pending and of a rejected restaurant, and
// of a DiNNo administrator (platform_admin, without a restaurant).
export function approvalTestUsers(): User[] {
  return [
    {
      id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081',
      email: 'pendiente@example.com',
      firebaseUid: 'uid-pending',
      role: UserRole.RESTAURANT_ADMIN,
      displayName: null,
      restaurantId: PENDING_RESTAURANT_ID,
    },
    {
      id: 'f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f708192',
      email: 'rechazado@example.com',
      firebaseUid: 'uid-rejected',
      role: UserRole.RESTAURANT_ADMIN,
      displayName: null,
      restaurantId: REJECTED_RESTAURANT_ID,
    },
    {
      id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3',
      email: 'admin@example.com',
      firebaseUid: 'uid-admin',
      role: UserRole.PLATFORM_ADMIN,
      displayName: null,
      restaurantId: null,
    },
  ] as User[];
}

// The users rows of the diner and of the owner of ownerRestaurantId.
export function testUsers(ownerRestaurantId: string): User[] {
  return [
    {
      id: '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a',
      email: 'diner@example.com',
      firebaseUid: 'uid-diner',
      role: UserRole.DINER,
      displayName: 'Comensal',
      restaurantId: null,
    },
    {
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      email: 'owner@example.com',
      firebaseUid: 'uid-owner',
      role: UserRole.RESTAURANT_ADMIN,
      displayName: null,
      restaurantId: ownerRestaurantId,
    },
  ] as User[];
}

// Read-only users repository: what the Firebase resolver needs.
export function usersRepository(users: User[]) {
  return {
    findOneBy: (where: Partial<User>) =>
      Promise.resolve(
        users.find((user) =>
          Object.entries(where).every(
            ([key, value]) => user[key as keyof User] === value,
          ),
        ) ?? null,
      ),
  };
}

// Firebase Auth that accepts the TEST_TOKENS (email verified) and rejects
// anything else like an invalid token.
export const fakeFirebaseAuth = {
  verifyIdToken: (token: string) => {
    const account = TEST_TOKENS[token];
    return account
      ? Promise.resolve({ email_verified: true, ...account })
      : Promise.reject(
          Object.assign(new Error('bad token'), {
            code: 'auth/argument-error',
          }),
        );
  },
};

// Replaces RestaurantApprovalReader (identity-access), which reads
// restaurants.approval_status for every restaurant_admin with a restaurant.
// Every e2e test that mounts IdentityAccessModule says explicitly which
// approval its restaurants have:
//   .overrideProvider(RestaurantApprovalReader).useValue(approvalReader('approved'))
// or, by restaurant id, approvalReader({ [PENDING_ID]: 'pending', ... }). An id
// missing from the map throws, like a restaurant that does not exist (500).
export function approvalReader(
  statuses: RestaurantApprovalStatus | Record<string, RestaurantApprovalStatus>,
) {
  return {
    statusOf: (restaurantId: string) => {
      const status =
        typeof statuses === 'string' ? statuses : statuses[restaurantId];
      return status === undefined
        ? Promise.reject(
            new Error(
              `Restaurant ${restaurantId} of the session user not found`,
            ),
          )
        : Promise.resolve(status);
    },
  };
}
