import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { HttpException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../../common/database/unique-violation.js';
import {
  accountForbidden,
  emailNotVerified,
  PENDING,
  sessionExpired,
  UserRole,
  UsersService,
  type RequestIdentity,
} from '../../identity-access/index.js';
import type { SignupRestaurantDto } from './dto/signup-restaurant.dto.js';
import {
  ALREADY_REGISTERED_MESSAGE,
  type RestaurantProfile,
} from './restaurant-registration.service.js';
import { toScheduleRow } from './restaurant-schedule-rows.js';
import { RestaurantSchedule } from './restaurant-schedule.entity.js';
import { Restaurant } from './restaurant.entity.js';

// 409 of a restaurant_admin enabled by hand by the team who has not registered
// its restaurant yet: it must use the registration form (POST /v1/restaurants).
export const ALREADY_ENABLED_MESSAGE =
  'Tu cuenta ya está habilitada como restaurante. Registra tu restaurante desde el formulario de registro.';

// Unique constraints of users that two sign-ups of the same account can hit.
const USER_UNIQUE_CONSTRAINTS = ['UQ_users_email', 'UQ_users_firebase_uid'];

// The account the caller already has, as the account it is: nothing is created.
interface ExistingAccount {
  role: UserRole;
  restaurantId: string | null;
}

function existingAccountError(account: ExistingAccount): HttpException {
  switch (account.role) {
    case UserRole.DINER:
      return accountForbidden('DINER_ACCOUNT');
    case UserRole.PLATFORM_ADMIN:
      return accountForbidden('ADMIN_ACCOUNT');
    case UserRole.RESTAURANT_ADMIN:
      return new ConflictException(
        account.restaurantId === null
          ? ALREADY_ENABLED_MESSAGE
          : ALREADY_REGISTERED_MESSAGE,
      );
  }
}

// Public sign-up of a restaurant (CLAUDE.md §11, "Aprobación de restaurantes"):
// a Firebase account without a users row creates its restaurant_admin user and
// its restaurant, pending approval, in one transaction. With POST
// /v1/diners/me, the only routes that create users.
@Injectable()
export class RestaurantSignupService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurants: Repository<Restaurant>,
    private readonly users: UsersService,
  ) {}

  async signup(
    identity: RequestIdentity,
    dto: SignupRestaurantDto,
  ): Promise<RestaurantProfile> {
    if (identity.kind === 'registered') {
      throw existingAccountError(identity.user);
    }
    const { firebase } = identity;
    // Defensa en profundidad: el resolver ya lo garantiza.
    if (!firebase.emailVerified) {
      throw emailNotVerified();
    }

    try {
      return await this.restaurants.manager.transaction(async (manager) => {
        // The user first: two sign-ups of the same account collide here, on
        // its unique constraints, before anything else is written.
        const user = await this.users.create(
          {
            firebaseUid: firebase.uid,
            email: firebase.email,
            role: UserRole.RESTAURANT_ADMIN,
            restaurantId: null,
            displayName: null,
          },
          manager,
        );
        const restaurant = await manager.save(
          manager.create(Restaurant, {
            name: dto.name,
            category: dto.category,
            address: dto.address,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
            contactPhone: dto.contactPhone,
            approvalStatus: PENDING,
          }),
        );
        const schedules = await manager.save(
          dto.schedules.map((day) =>
            manager.create(
              RestaurantSchedule,
              toScheduleRow(restaurant.id, day),
            ),
          ),
        );
        const linked = await this.users.assignRestaurantIfNone(
          user.id,
          restaurant.id,
          manager,
        );
        if (!linked) {
          // The user was created by this same transaction without a
          // restaurant: unreachable. The rollback leaves nothing behind.
          throw new Error(`User ${user.id} of the sign-up was not linked`);
        }
        return { restaurant, schedules };
      });
    } catch (error) {
      if (
        !USER_UNIQUE_CONSTRAINTS.some((name) => isUniqueViolation(error, name))
      ) {
        throw error;
      }
      // Two sign-ups of the same account at once: the other one won and this
      // transaction left nothing. Answer as the account that now exists.
      const winner = await this.users.findByFirebaseUid(firebase.uid);
      if (!winner) {
        // The email belongs to another row (and UID): same 401 as the login.
        throw sessionExpired();
      }
      throw existingAccountError(winner);
    }
  }
}
