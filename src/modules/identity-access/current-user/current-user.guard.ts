import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserData } from './current-user-data.js';
import { CurrentUserResolver } from './current-user.resolver.js';

export interface RequestWithCurrentUser extends Request {
  currentUser?: CurrentUserData;
}

@Injectable()
export class CurrentUserGuard implements CanActivate {
  constructor(private readonly resolver: CurrentUserResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCurrentUser>();
    request.currentUser = await this.resolver.resolve(request);
    return true;
  }
}
