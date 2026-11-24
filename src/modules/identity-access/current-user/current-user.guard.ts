import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserData, RequestIdentity } from './current-user-data.js';
import { CurrentUserResolver } from './current-user.resolver.js';

export interface RequestWithCurrentUser extends Request {
  identity?: RequestIdentity;
  // Only for registered accounts: what @CurrentUser() returns.
  currentUser?: CurrentUserData;
}

@Injectable()
export class CurrentUserGuard implements CanActivate {
  constructor(private readonly resolver: CurrentUserResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCurrentUser>();
    const identity = await this.resolver.resolve(request);
    request.identity = identity;
    if (identity.kind === 'registered') {
      request.currentUser = identity.user;
    }
    return true;
  }
}
