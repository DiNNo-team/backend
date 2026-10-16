import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { assertSafeDeploymentConfig } from './auth/deployment-safety.js';
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
import { RolesGuard } from './roles/roles.guard.js';
import { DinersController } from './diners/diners.controller.js';
import { DinersService } from './diners/diners.service.js';
import { MeController } from './users/me.controller.js';
import { DinerSocketAuthenticator } from './realtime/diner-socket-authenticator.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [MeController, DinersController],
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
    RolesGuard,
    UsersService,
    DinersService,
    DinerSocketAuthenticator,
  ],
  exports: [
    CurrentUserResolver,
    CurrentUserGuard,
    RolesGuard,
    UsersService,
    DinerSocketAuthenticator,
  ],
})
export class IdentityAccessModule implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  // Stops the boot before the app serves a single request.
  onModuleInit(): void {
    assertSafeDeploymentConfig(this.config);
  }
}
