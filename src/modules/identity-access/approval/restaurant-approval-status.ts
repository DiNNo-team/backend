// Estado de aprobación de un restaurante (columna restaurants.approval_status,
// CHK_restaurants_approval_status). Vive aquí y no en restaurant-operations
// porque el control de acceso lo necesita y restaurant-operations ya importa
// identity-access (al revés sería un ciclo). Cambiar la lista exige una
// migración escrita a mano que borre y vuelva a crear el check.
//   pending  → registrado por POST /v1/restaurants/signup, en revisión.
//   approved → visible para los comensales y operable.
//   rejected → no aprobado; ve el motivo (rejection_reason).
export const RESTAURANT_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const;

export type RestaurantApprovalStatus =
  (typeof RESTAURANT_APPROVAL_STATUSES)[number];

export const APPROVED: RestaurantApprovalStatus = 'approved';
export const PENDING: RestaurantApprovalStatus = 'pending';
export const REJECTED: RestaurantApprovalStatus = 'rejected';
