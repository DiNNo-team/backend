// One role per account (Sprint 2 contract): restaurant_admin uses the web,
// diner uses the app, platform_admin is a DiNNo administrator (web admin panel;
// created only by seed or SQL, never by a sign-up). users.role has a check with
// exactly these values (CHK_users_role): adding one needs a hand-written
// migration.
export enum UserRole {
  RESTAURANT_ADMIN = 'restaurant_admin',
  DINER = 'diner',
  PLATFORM_ADMIN = 'platform_admin',
}

export const USER_ROLES = Object.values(UserRole);
