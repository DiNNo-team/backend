export interface CurrentUserData {
  userId: number;
  // null: the user has not registered a restaurant yet (onboarding).
  restaurantId: number | null;
  role: string;
}
