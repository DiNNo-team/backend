import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { CurrentUserData } from './current-user-data.js';
import {
  CurrentUserGuard,
  type RequestWithCurrentUser,
} from './current-user.guard.js';
import type { CurrentUserResolver } from './current-user.resolver.js';

function contextFor(request: RequestWithCurrentUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CurrentUserGuard', () => {
  it('stores the resolved user on the request', async () => {
    const currentUser: CurrentUserData = {
      userId: 2,
      restaurantId: null,
      role: 'restaurant_admin',
    };
    const resolver = { resolve: vi.fn().mockResolvedValue(currentUser) };
    const guard = new CurrentUserGuard(
      resolver as unknown as CurrentUserResolver,
    );
    const request = { headers: {} } as RequestWithCurrentUser;

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.currentUser).toEqual(currentUser);
  });

  it('propagates UnauthorizedException from the resolver', async () => {
    const resolver = {
      resolve: vi.fn().mockRejectedValue(new UnauthorizedException()),
    };
    const guard = new CurrentUserGuard(
      resolver as unknown as CurrentUserResolver,
    );
    const request = { headers: {} } as RequestWithCurrentUser;

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.currentUser).toBeUndefined();
  });
});
