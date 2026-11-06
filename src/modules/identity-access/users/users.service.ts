import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { UserRole } from '../roles/user-role.js';
import { isUniqueViolation } from '../../../common/database/unique-violation.js';
import { DISPLAY_NAME_MAX_LENGTH } from '../diners/dto/register-diner.dto.js';
import { User } from './user.entity.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// True when the name is the default of POST /v1/diners/me: the email before the
// @, cut like the column. Exact match only: "Ana María" with ana@example.com is a
// real name.
function isEmailDerivedName(
  displayName: string | null,
  email: string,
): boolean {
  if (displayName === null) {
    return false;
  }
  const localPart = [...normalizeEmail(email).split('@')[0]]
    .slice(0, DISPLAY_NAME_MAX_LENGTH)
    .join('')
    .trim();
  return displayName.trim().toLowerCase() === localPart;
}

export interface CreateUserInput {
  firebaseUid: string;
  email: string;
  role: UserRole;
  restaurantId: string | null;
  displayName: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ firebaseUid });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email: normalizeEmail(email) });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  // Emails of restaurant admins by user id, in one query, for other modules that
  // show who did something (the table log). The role goes in the query, so a
  // diner's email never leaves the database. Unknown ids and any other role are
  // left out of the map.
  async findRestaurantAdminEmailsByIds(
    ids: string[],
  ): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.usersRepository.find({
      where: { id: In(uniqueIds), role: UserRole.RESTAURANT_ADMIN },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.email]));
  }

  // Names that someone else may see (the restaurant, CLAUDE.md §11), by user id,
  // in one query. null when there is no name or when the stored name is the
  // email before the @, the default of POST /v1/diners/me: that would reveal part
  // of the email. The email is read only to compare it and is never returned.
  // Unknown ids are left out.
  async findPublicDisplayNamesByIds(
    ids: string[],
  ): Promise<Map<string, string | null>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.usersRepository.find({
      where: { id: In(uniqueIds) },
      select: { id: true, displayName: true, email: true },
    });
    return new Map(
      users.map((user) => [
        user.id,
        isEmailDerivedName(user.displayName, user.email)
          ? null
          : user.displayName,
      ]),
    );
  }

  // The row of the session user, which the guard has just resolved: a
  // missing row is a bug, so the global filter logs it and answers the 500.
  async getSessionUser(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new Error(`User ${id} of the session not found`);
    }
    return user;
  }

  // userId must come from the session, never the request body. Returns true
  // when assigned, false when the user is missing or already has a restaurant.
  // Call with the transaction manager that creates the restaurant.
  async assignRestaurantIfNone(
    userId: string,
    restaurantId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const result = await manager.update(
      User,
      { id: userId, restaurantId: IsNull() },
      { restaurantId },
    );

    return (result.affected ?? 0) > 0;
  }

  async linkFirebaseUid(user: User, firebaseUid: string): Promise<User> {
    user.firebaseUid = firebaseUid;
    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (!isUniqueViolation(error, 'UQ_users_firebase_uid')) {
        throw error;
      }

      const linkedUser = await this.findByFirebaseUid(firebaseUid);
      if (linkedUser?.firebaseUid === firebaseUid) {
        return linkedUser;
      }
      throw error;
    }
  }

  // Only POST /v1/diners/me creates users (Sprint 2); restaurant accounts are
  // enabled by hand (docs/database.md, "Restaurantes habilitados").
  create(input: CreateUserInput): Promise<User> {
    const user = this.usersRepository.create({
      email: normalizeEmail(input.email),
      firebaseUid: input.firebaseUid,
      role: input.role,
      restaurantId: input.restaurantId,
      displayName: input.displayName,
    });
    return this.usersRepository.save(user);
  }
}
