import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Repository } from 'typeorm';
import type { User } from '../users/user.entity.js';
import { DEV_USER_HEADER, DevUserResolver } from './dev-user.resolver.js';

const OWNER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWCOMER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const owner = {
  id: OWNER_ID,
  role: 'restaurant_admin',
  restaurantId: RESTAURANT_ID,
} as User;
const newcomer = {
  id: NEWCOMER_ID,
  role: 'restaurant_admin',
  restaurantId: null,
} as User;

function createResolver(env: Record<string, string>) {
  const usersById = new Map([owner, newcomer].map((user) => [user.id, user]));
  const users = {
    findOneBy: vi.fn(({ id }: { id: string }) =>
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

const devEnv = { DEV_USER_ENABLED: 'true', DEV_USER_ID: OWNER_ID };

describe('DevUserResolver', () => {
  it('returns the default dev user with its three fields', async () => {
    const { resolver } = createResolver(devEnv);

    await expect(resolver.resolve(requestWith())).resolves.toEqual({
      userId: OWNER_ID,
      restaurantId: RESTAURANT_ID,
      role: 'restaurant_admin',
    });
  });

  it('returns restaurantId as null for a user without a restaurant', async () => {
    const { resolver } = createResolver({
      ...devEnv,
      DEV_USER_ID: NEWCOMER_ID,
    });

    const user = await resolver.resolve(requestWith());

    expect(user.restaurantId).toBeNull();
  });

  it('switches user with the x-dev-user-id header', async () => {
    const { resolver, users } = createResolver(devEnv);

    const user = await resolver.resolve(
      requestWith({ [DEV_USER_HEADER]: NEWCOMER_ID }),
    );

    expect(user.userId).toBe(NEWCOMER_ID);
    expect(users.findOneBy).toHaveBeenCalledWith({ id: NEWCOMER_ID });
  });

  it('accepts an uppercase UUID with surrounding spaces', async () => {
    const { resolver, users } = createResolver(devEnv);

    await resolver.resolve(
      requestWith({ [DEV_USER_HEADER]: ` ${NEWCOMER_ID.toUpperCase()} ` }),
    );

    expect(users.findOneBy).toHaveBeenCalledWith({ id: NEWCOMER_ID });
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
    const { resolver } = createResolver({ ...devEnv, DEV_USER_ID: UNKNOWN_ID });

    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    'abc',
    '1',
    'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5',
    'g1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d',
    '',
  ])('rejects a malformed UUID (%j)', async (invalidId) => {
    const { resolver, users } = createResolver(devEnv);

    await expect(
      resolver.resolve(requestWith({ [DEV_USER_HEADER]: invalidId })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findOneBy).not.toHaveBeenCalled();
  });

  it('rejects when there is neither DEV_USER_ID nor header', async () => {
    const { resolver } = createResolver({ DEV_USER_ENABLED: 'true' });

    await expect(resolver.resolve(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
