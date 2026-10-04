import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Repository } from 'typeorm';
import type { User } from '../users/user.entity.js';
import { DEV_USER_HEADER, DevUserResolver } from './dev-user.resolver.js';

const owner = { id: 1, role: 'restaurant_admin', restaurantId: 72 } as User;
const newcomer = {
  id: 2,
  role: 'restaurant_admin',
  restaurantId: null,
} as User;

function createResolver(env: Record<string, string>) {
  const usersById = new Map([owner, newcomer].map((user) => [user.id, user]));
  const users = {
    findOneBy: vi.fn(({ id }: { id: number }) =>
      Promise.resolve(usersById.get(id) ?? null),
    ),
  };
  const config = { get: (key: string) => env[key] } as ConfigService;
  const resolver = new DevUserResolver(
    users as unknown as Repository<User>,
    config,
  );
  return { resolver, users };
}

function requestWith(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

const devEnv = { DEV_USER_ENABLED: 'true', DEV_USER_ID: '1' };

describe('DevUserResolver', () => {
  it('returns the default dev user with its three fields', async () => {
    const { resolver } = createResolver(devEnv);

    await expect(resolver.resolve(requestWith())).resolves.toEqual({
      userId: 1,
      restaurantId: 72,
      role: 'restaurant_admin',
    });
  });

  it('returns restaurantId as null for a user without a restaurant', async () => {
    const { resolver } = createResolver({ ...devEnv, DEV_USER_ID: '2' });

    const user = await resolver.resolve(requestWith());

    expect(user.restaurantId).toBeNull();
  });

  it('switches user with the x-dev-user-id header', async () => {
    const { resolver, users } = createResolver(devEnv);

    const user = await resolver.resolve(
      requestWith({ [DEV_USER_HEADER]: '2' }),
    );

    expect(user.userId).toBe(2);
    expect(users.findOneBy).toHaveBeenCalledWith({ id: 2 });
  });

  it('reads the user from the database on every request', async () => {
    const { resolver, users } = createResolver(devEnv);

    await resolver.resolve(requestWith());
    await resolver.resolve(requestWith());

    expect(users.findOneBy).toHaveBeenCalledTimes(2);
  });

  it('rejects when the dev user is disabled', async () => {
    const { resolver, users } = createResolver({
      ...devEnv,
      DEV_USER_ENABLED: 'false',
    });

    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.findOneBy).not.toHaveBeenCalled();
  });

  it.each([{ RENDER: 'true' }, { NODE_ENV: 'production' }])(
    'rejects in a deployed environment even if enabled (%o)',
    async (deployedEnv) => {
      const { resolver } = createResolver({ ...devEnv, ...deployedEnv });

      expect(resolver.enabled).toBe(false);
      await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it('rejects when the user does not exist in the database', async () => {
    const { resolver } = createResolver({ ...devEnv, DEV_USER_ID: '99' });

    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each(['abc', '0', '-1', '1.5', ''])(
    'rejects an invalid user id (%j)',
    async (invalidId) => {
      const { resolver, users } = createResolver(devEnv);

      await expect(
        resolver.resolve(requestWith({ [DEV_USER_HEADER]: invalidId })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.findOneBy).not.toHaveBeenCalled();
    },
  );

  it('rejects when there is neither DEV_USER_ID nor header', async () => {
    const { resolver } = createResolver({ DEV_USER_ENABLED: 'true' });

    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
