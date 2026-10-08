import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import { User } from './user.entity.js';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateUserInput {
  firebaseUid: string;
  email: string;
  role: string;
  restaurantId: string | null;
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
      if (
        !(error instanceof QueryFailedError) ||
        error.driverError.code !== '23505' ||
        error.driverError.constraint !== 'UQ_users_firebase_uid'
      ) {
        throw error;
      }

      const linkedUser = await this.findByFirebaseUid(firebaseUid);
      if (linkedUser?.firebaseUid === firebaseUid) {
        return linkedUser;
      }
      throw error;
    }
  }

  create(input: CreateUserInput): Promise<User> {
    const user = this.usersRepository.create({
      email: normalizeEmail(input.email),
      firebaseUid: input.firebaseUid,
      role: input.role,
      restaurantId: input.restaurantId,
    });
    return this.usersRepository.save(user);
  }
}
