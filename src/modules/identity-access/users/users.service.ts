import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import type { UserRole } from '../roles/user-role.js';
import { isUniqueViolation } from '../../../common/database/unique-violation.js';
import { User } from './user.entity.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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

  // Emails by user id, in one query, for other modules that show who did
  // something (the table log). Unknown ids are left out of the map.
  async findEmailsByIds(ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const users = await this.usersRepository.find({
      where: { id: In(uniqueIds) },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.email]));
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
