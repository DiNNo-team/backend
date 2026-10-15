import type { DecodedIdToken } from 'firebase-admin/auth';
import { UserRole } from './../../src/modules/identity-access/index.js';
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
};

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
