import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUserData, RequestIdentity } from './current-user-data.js';
import type { RequestWithCurrentUser } from './current-user.guard.js';

// The registered user of the session. Routes with @Roles never get here with
// an unregistered account (RolesGuard answers 403 first).
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserData => {
    const request = context.switchToHttp().getRequest<RequestWithCurrentUser>();
    if (!request.currentUser) {
      throw new Error(
        '@CurrentUser() requires CurrentUserGuard and a registered user: add @Roles to the route, or use @CurrentIdentity().',
      );
    }
    return request.currentUser;
  },
);

// Registered or unregistered identity of the session, for the few routes that
// accept an account without a users row (POST /v1/diners/me).
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestIdentity => {
    const request = context.switchToHttp().getRequest<RequestWithCurrentUser>();
    if (!request.identity) {
      throw new Error('@CurrentIdentity() requires CurrentUserGuard.');
    }
    return request.identity;
  },
);
