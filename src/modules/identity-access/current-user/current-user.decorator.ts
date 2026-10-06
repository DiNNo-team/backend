import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUserData } from './current-user-data.js';
import type { RequestWithCurrentUser } from './current-user.guard.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserData => {
    const request = context.switchToHttp().getRequest<RequestWithCurrentUser>();
    if (!request.currentUser) {
      throw new Error(
        '@CurrentUser() requires CurrentUserGuard on the route or controller.',
      );
    }
    return request.currentUser;
  },
);
