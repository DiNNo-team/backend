import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrentUserGuard } from './current-user/current-user.guard.js';
import { CurrentUserResolver } from './current-user/current-user.resolver.js';
import { DevUserResolver } from './current-user/dev-user.resolver.js';
import { User } from './users/user.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [
    { provide: CurrentUserResolver, useClass: DevUserResolver },
    CurrentUserGuard,
  ],
  exports: [CurrentUserResolver, CurrentUserGuard],
})
export class IdentityAccessModule {}
