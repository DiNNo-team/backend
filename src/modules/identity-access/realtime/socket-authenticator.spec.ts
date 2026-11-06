import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { emailNotVerified, sessionExpired } from '../auth/auth-errors.js';
import { selectCurrentUserResolver } from '../auth/current-user-resolver.factory.js';
import { FirebaseUserResolver } from '../auth/firebase-user.resolver.js';
import type { RequestIdentity } from '../current-user/current-user-data.js';
import type { CurrentUserResolver } from '../current-user/current-user.resolver.js';
import { DevUserResolver } from '../current-user/dev-user.resolver.js';
import { UserRole } from '../roles/user-role.js';
import type { User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { RESTAURANT_REQUIRED_CODE } from '../../restaurant-operations/index.js';
import {
  SOCKET_REJECTION_CODES,
  SocketAuthenticator,
  SocketRejection,
} from './socket-authenticator.js';

const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';

const diner: RequestIdentity = {
  kind: 'registered',
  user: { userId: DINER_ID, restaurantId: null, role: UserRole.DINER },
};

const owner: RequestIdentity = {
  kind: 'registered',
  user: {
    userId: OWNER_ID,
    restaurantId: RESTAURANT_ID,
    role: UserRole.RESTAURANT_ADMIN,
  },
};

async function rejectionCode(
  authenticator: SocketAuthenticator,
  auth: unknown,
): Promise<string> {
  try {
    await authenticator.authenticate(auth);
  } catch (error) {
    if (error instanceof SocketRejection) {
      // The message is the code alone: it is what connect_error shows.
      expect(error.message).toBe(error.code);
      return error.code;
    }
    throw error;
  }
  throw new Error('Expected the handshake to be rejected');
}

describe('SocketAuthenticator', () => {
  function withResolver(resolve: ReturnType<typeof vi.fn>) {
    const resolver = { resolve } as unknown as CurrentUserResolver;
    return { authenticator: new SocketAuthenticator(resolver), resolve };
  }

  it('accepts a restaurant_admin with a restaurant and returns its restaurant', async () => {
    const { authenticator } = withResolver(vi.fn().mockResolvedValue(owner));

    await expect(authenticator.authenticate({ token: 't' })).resolves.toEqual({
      userId: OWNER_ID,
      restaurantId: RESTAURANT_ID,
      role: UserRole.RESTAURANT_ADMIN,
    });
  });

  it('uses the same RESTAURANT_REQUIRED code as the HTTP 403, and no longer RESTAURANT_ACCOUNT', () => {
    expect(SOCKET_REJECTION_CODES).toContain(RESTAURANT_REQUIRED_CODE);
    expect(SOCKET_REJECTION_CODES).not.toContain('RESTAURANT_ACCOUNT');
  });

  it('accepts a diner and builds the Authorization header from auth.token', async () => {
    const { authenticator, resolve } = withResolver(
      vi.fn().mockResolvedValue(diner),
    );

    await expect(
      authenticator.authenticate({ token: 'firebase-token' }),
    ).resolves.toEqual(diner.kind === 'registered' && diner.user);
    expect(resolve).toHaveBeenCalledWith({
      headers: { authorization: 'Bearer firebase-token' },
    });
  });

  it('passes auth.devUserId as the x-dev-user-id header', async () => {
    const { authenticator, resolve } = withResolver(
      vi.fn().mockResolvedValue(diner),
    );

    await authenticator.authenticate({ devUserId: DINER_ID });

    expect(resolve).toHaveBeenCalledWith({
      headers: { 'x-dev-user-id': DINER_ID },
    });
  });

  it.each([
    ['no auth at all', undefined],
    ['an auth that is not an object', 'token'],
    ['an empty token', { token: '' }],
    ['a token that is not text', { token: 42 }],
  ])('sends no Authorization header for %s', async (_case, auth) => {
    const { authenticator, resolve } = withResolver(
      vi.fn().mockRejectedValue(sessionExpired()),
    );

    await expect(rejectionCode(authenticator, auth)).resolves.toBe(
      'UNAUTHORIZED',
    );
    expect(resolve).toHaveBeenCalledWith({ headers: {} });
  });

  it.each([
    [
      'a missing, invalid or expired token → UNAUTHORIZED',
      vi.fn().mockRejectedValue(sessionExpired()),
      'UNAUTHORIZED',
    ],
    [
      'an unknown development user (another 401) → UNAUTHORIZED',
      vi.fn().mockRejectedValue(new UnauthorizedException('No existe')),
      'UNAUTHORIZED',
    ],
    [
      'an email not verified → EMAIL_NOT_VERIFIED',
      vi.fn().mockRejectedValue(emailNotVerified()),
      'EMAIL_NOT_VERIFIED',
    ],
    [
      'an account without profile → PROFILE_REQUIRED',
      vi.fn().mockResolvedValue({
        kind: 'unregistered',
        firebase: {
          uid: 'uid-new',
          email: 'nueva@example.com',
          name: null,
          emailVerified: true,
        },
      }),
      'PROFILE_REQUIRED',
    ],
    [
      'a restaurant_admin without a restaurant → RESTAURANT_REQUIRED',
      vi.fn().mockResolvedValue({
        kind: 'registered',
        user: {
          userId: OWNER_ID,
          restaurantId: null,
          role: UserRole.RESTAURANT_ADMIN,
        },
      }),
      'RESTAURANT_REQUIRED',
    ],
  ])('rejects %s', async (_case, resolve, code) => {
    const { authenticator } = withResolver(resolve);

    await expect(rejectionCode(authenticator, { token: 't' })).resolves.toBe(
      code,
    );
  });

  it('lets an error that is not about the session through (the gateway logs it)', async () => {
    const failure = new Error('database down');
    const { authenticator } = withResolver(vi.fn().mockRejectedValue(failure));

    await expect(authenticator.authenticate({ token: 't' })).rejects.toBe(
      failure,
    );
  });

  // With the real resolvers, as IdentityAccessModule selects them: devUserId
  // only works while the development user is on, and never when deployed.
  describe('devUserId with the real resolvers', () => {
    function realAuthenticator(env: Record<string, string>) {
      const config = { get: (key: string) => env[key] } as ConfigService;
      const users = {
        findOneBy: vi.fn(({ id }: { id: string }) =>
          Promise.resolve(
            id === DINER_ID
              ? ({ id, role: UserRole.DINER, restaurantId: null } as User)
              : null,
          ),
        ),
      };
      const verifyIdToken = vi.fn().mockRejectedValue(
        Object.assign(new Error('bad token'), {
          code: 'auth/argument-error',
        }),
      );
      const resolver = selectCurrentUserResolver(
        new DevUserResolver(users as unknown as Repository<User>, config),
        new FirebaseUserResolver(
          () => ({ verifyIdToken }) as never,
          {} as UsersService,
        ),
        {
          getOrThrow: () => 'firebase-project-example',
        } as unknown as ConfigService,
      );
      return {
        authenticator: new SocketAuthenticator(resolver),
        users,
      };
    }

    it('accepts the diner of devUserId while the development user is on', async () => {
      const { authenticator } = realAuthenticator({ DEV_USER_ENABLED: 'true' });

      await expect(
        authenticator.authenticate({ devUserId: DINER_ID }),
      ).resolves.toMatchObject({ userId: DINER_ID, role: UserRole.DINER });
    });

    it.each([
      ['turned off', { DEV_USER_ENABLED: 'false' }],
      [
        'on but deployed (RENDER)',
        { DEV_USER_ENABLED: 'true', RENDER: 'true' },
      ],
      [
        'on but deployed (NODE_ENV=production)',
        { DEV_USER_ENABLED: 'true', NODE_ENV: 'production' },
      ],
    ])(
      'ignores devUserId when the development user is %s',
      async (_case, env) => {
        const { authenticator, users } = realAuthenticator(env);

        await expect(
          rejectionCode(authenticator, { devUserId: DINER_ID }),
        ).resolves.toBe('UNAUTHORIZED');
        expect(users.findOneBy).not.toHaveBeenCalled();
      },
    );
  });
});
