import { Injectable } from '@nestjs/common';
import { emailNotVerified, sessionExpired } from '../auth/auth-errors.js';
import type {
  FirebaseIdentityData,
  RequestIdentity,
} from '../current-user/current-user-data.js';
import { accountForbidden } from '../roles/account-errors.js';
import { UserRole } from '../roles/user-role.js';
import { isUniqueViolation } from '../../../common/database/unique-violation.js';
import type { User } from '../users/user.entity.js';
import { normalizeEmail, UsersService } from '../users/users.service.js';
import { DISPLAY_NAME_MAX_LENGTH } from './dto/register-diner.dto.js';

export interface DinerRegistration {
  user: User;
  // false: the diner already existed and nothing changed (200, not 201).
  created: boolean;
}

// Cut in code points, like the varchar(60) column.
function truncate(text: string, max: number): string {
  return [...text].slice(0, max).join('');
}

// Body name, else the Google account name, else the email before the @.
function defaultDisplayName(
  firebase: FirebaseIdentityData,
  displayName: string | undefined,
): string {
  if (displayName !== undefined) {
    return displayName;
  }
  const fallback =
    firebase.name ?? normalizeEmail(firebase.email).split('@')[0];
  return truncate(fallback.trim(), DISPLAY_NAME_MAX_LENGTH);
}

// POST /v1/diners/me: the only way a users row is created (Sprint 2).
@Injectable()
export class DinersService {
  constructor(private readonly users: UsersService) {}

  async register(
    identity: RequestIdentity,
    displayName: string | undefined,
  ): Promise<DinerRegistration> {
    if (identity.kind === 'registered') {
      return this.existing(identity.user.userId, identity.user.role);
    }

    const { firebase } = identity;
    // Defensa en profundidad: el resolver ya lo garantiza.
    if (!firebase.emailVerified) {
      throw emailNotVerified();
    }

    try {
      const user = await this.users.create({
        firebaseUid: firebase.uid,
        email: firebase.email,
        role: UserRole.DINER,
        restaurantId: null,
        displayName: defaultDisplayName(firebase, displayName),
      });
      return { user, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Two sign-ups at once: the other one created the row.
      const winner = await this.users.findByFirebaseUid(firebase.uid);
      if (!winner) {
        // The email belongs to another row (and UID): same 401 as the login.
        throw sessionExpired();
      }
      return this.existing(winner.id, winner.role);
    }
  }

  private async existing(
    userId: string,
    role: UserRole,
  ): Promise<DinerRegistration> {
    if (role === UserRole.RESTAURANT_ADMIN) {
      throw accountForbidden('RESTAURANT_ACCOUNT');
    }
    return { user: await this.users.getSessionUser(userId), created: false };
  }
}
