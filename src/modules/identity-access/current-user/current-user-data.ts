export interface CurrentUserData {
  userId: string;
  // null: the user has not registered a restaurant yet (onboarding).
  restaurantId: string | null;
  role: string;
}
