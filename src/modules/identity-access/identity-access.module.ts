import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrentUserGuard } from './current-user/current-user.guard.js';
import { CurrentUserResolver } from './current-user/current-user.resolver.js';
import { DevUserResolver } from './current-user/dev-user.resolver.js';
import {
  createFirebaseAuthFactory,
  FIREBASE_AUTH,
} from './auth/firebase-admin.provider.js';
import { selectCurrentUserResolver } from './auth/current-user-resolver.factory.js';
import { FirebaseUserResolver } from './auth/firebase-user.resolver.js';
import { User } from './users/user.entity.js';
import { UsersService } from './users/users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [
    DevUserResolver,
    FirebaseUserResolver,
    {
      provide: FIREBASE_AUTH,
      inject: [ConfigService],
      useFactory: createFirebaseAuthFactory,
    },
    {
      provide: CurrentUserResolver,
      inject: [DevUserResolver, FirebaseUserResolver, ConfigService],
      useFactory: selectCurrentUserResolver,
    },
    CurrentUserGuard,
    UsersService,
  ],
  exports: [CurrentUserResolver, CurrentUserGuard, UsersService],
})
export class IdentityAccessModule {}
