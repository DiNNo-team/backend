import type { RestaurantApprovalReader } from '../approval/restaurant-approval.reader.js';
import { UserRole } from '../roles/user-role.js';
import type { User } from '../users/user.entity.js';
import type { RequestIdentity } from './current-user-data.js';

// The registered identity of a users row, shared by every resolver (Firebase
// and the development user), so the approval rule is loaded in one place. Only
// a restaurant_admin with a restaurant has an approval status to read.
export async function registeredIdentity(
  user: User,
  approvals: RestaurantApprovalReader,
): Promise<RequestIdentity> {
  const restaurantApproval =
    user.role === UserRole.RESTAURANT_ADMIN && user.restaurantId !== null
      ? await approvals.statusOf(user.restaurantId)
      : null;
  return {
    kind: 'registered',
    user: {
      userId: user.id,
      restaurantId: user.restaurantId,
      role: user.role,
      restaurantApproval,
    },
  };
}
