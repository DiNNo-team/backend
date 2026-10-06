import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  linkFirebaseUid(user: User, firebaseUid: string): Promise<User> {
    user.firebaseUid = firebaseUid;
    return this.usersRepository.save(user);
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
