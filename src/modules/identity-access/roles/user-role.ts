// One role per account (Sprint 2 contract): restaurant_admin uses the web,
// diner uses the app. users.role has a check with exactly these values
// (CHK_users_role): adding one needs a hand-written migration.
export enum UserRole {
  RESTAURANT_ADMIN = 'restaurant_admin',
  DINER = 'diner',
}

export const USER_ROLES = Object.values(UserRole);
