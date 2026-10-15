import type { UserRole } from '../roles/user-role.js';

// A registered account: a users row. What @CurrentUser() hands to controllers.
export interface CurrentUserData {
  userId: string;
  // null: the user has not registered a restaurant yet (onboarding).
  restaurantId: string | null;
  role: UserRole;
}

// What a verified Firebase ID token says about the account.
export interface FirebaseIdentityData {
  uid: string;
  // As it comes in the token; normalize it before storing or comparing.
  email: string;
  // Display name of the Firebase account (Google), if any.
  name: string | null;
  emailVerified: boolean;
}

// Who is calling: an account with a users row, or a valid Firebase account
// without one yet (Sprint 2: the backend no longer creates users on login).
export type RequestIdentity =
  | { kind: 'registered'; user: CurrentUserData }
  | { kind: 'unregistered'; firebase: FirebaseIdentityData };
