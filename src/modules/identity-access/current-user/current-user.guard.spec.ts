import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { RequestIdentity } from './current-user-data.js';
import {
  CurrentUserGuard,
  type RequestWithCurrentUser,
} from './current-user.guard.js';
import type { CurrentUserResolver } from './current-user.resolver.js';
import { UserRole } from '../roles/user-role.js';

function contextFor(request: RequestWithCurrentUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardResolving(identity: RequestIdentity) {
  const resolver = { resolve: vi.fn().mockResolvedValue(identity) };
  return new CurrentUserGuard(resolver as unknown as CurrentUserResolver);
}

describe('CurrentUserGuard', () => {
  it('stores a registered identity and its user on the request', async () => {
    const identity: RequestIdentity = {
      kind: 'registered',
      user: {
        userId: '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718',
        restaurantId: null,
        role: UserRole.RESTAURANT_ADMIN,
      },
    };
    const request = { headers: {} } as RequestWithCurrentUser;

    await expect(
      guardResolving(identity).canActivate(contextFor(request)),
    ).resolves.toBe(true);
    expect(request.identity).toEqual(identity);
    expect(request.currentUser).toEqual(identity.user);
  });

  it('stores an unregistered identity without a current user', async () => {
    const identity: RequestIdentity = {
      kind: 'unregistered',
      firebase: {
        uid: 'firebase-uid',
        email: 'ana@example.com',
        name: null,
        emailVerified: true,
      },
    };
    const request = { headers: {} } as RequestWithCurrentUser;

    await expect(
      guardResolving(identity).canActivate(contextFor(request)),
    ).resolves.toBe(true);
    expect(request.identity).toEqual(identity);
    expect(request.currentUser).toBeUndefined();
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
    expect(request.identity).toBeUndefined();
    expect(request.currentUser).toBeUndefined();
  });
});
