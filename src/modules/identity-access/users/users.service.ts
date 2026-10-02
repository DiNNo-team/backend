import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './users.entity.js';

export interface CreateUserInput {
  firebaseUid: string;
  email: string;
  role: UserRole;
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

  createUser(input: CreateUserInput): Promise<User> {
    const user = this.usersRepository.create(input);
    return this.usersRepository.save(user);
  }
}
