import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { User } from './user.entity.js';

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

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

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

  create(input: CreateUserInput): Promise<User> {
    const user = this.usersRepository.create({
      email: input.email,
      firebaseUid: input.firebaseUid,
      role: input.role,
      restaurantId: input.restaurantId,
    });
    return this.usersRepository.save(user);
  }
}
