import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type {
  FirebaseIdentityData,
  RequestIdentity,
} from '../current-user/current-user-data.js';
import { UserRole } from '../roles/user-role.js';
import type { User } from '../users/user.entity.js';
import type { UsersService } from '../users/users.service.js';
import { DinersService } from './diners.service.js';

const USER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';

function firebase(
  overrides: Partial<FirebaseIdentityData> = {},
): RequestIdentity {
  return {
    kind: 'unregistered',
    firebase: {
      uid: 'firebase-uid',
      email: ' Ana.Gomez@Example.com ',
      name: 'Ana Gómez',
      emailVerified: true,
      ...overrides,
    },
  };
}

function registered(role: UserRole): RequestIdentity {
  return {
    kind: 'registered',
    user: { userId: USER_ID, restaurantId: null, role },
  };
}

const diner = {
  id: USER_ID,
  email: 'ana.gomez@example.com',
  role: UserRole.DINER,
  displayName: 'Ana',
} as User;

function createService() {
  const users = {
    create: vi.fn((input: Partial<User>) =>
      Promise.resolve({ ...input, id: USER_ID } as User),
    ),
    getSessionUser: vi.fn().mockResolvedValue(diner),
    findByFirebaseUid: vi.fn().mockResolvedValue(null),
  };
  return {
    service: new DinersService(users as unknown as UsersService),
    users,
  };
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

describe('DinersService', () => {
  it('creates a diner with the body name', async () => {
    const { service, users } = createService();

    const result = await service.register(firebase(), 'Ana');

    expect(result.created).toBe(true);
    expect(users.create).toHaveBeenCalledWith({
      firebaseUid: 'firebase-uid',
      email: ' Ana.Gomez@Example.com ',
      role: UserRole.DINER,
      restaurantId: null,
      displayName: 'Ana',
    });
  });

  it('defaults the name to the Google account name', async () => {
    const { service, users } = createService();

    await service.register(firebase(), undefined);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Ana Gómez' }),
    );
  });

  it('defaults the name to the normalized email before the @', async () => {
    const { service, users } = createService();

    await service.register(firebase({ name: null }), undefined);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'ana.gomez' }),
    );
  });

  it('cuts a long default name to 60 characters', async () => {
    const { service, users } = createService();

    await service.register(firebase({ name: 'ñ'.repeat(70) }), undefined);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'ñ'.repeat(60) }),
    );
  });

  it('answers an existing diner without creating or changing anything', async () => {
    const { service, users } = createService();

    await expect(
      service.register(registered(UserRole.DINER), 'Otro nombre'),
    ).resolves.toEqual({ user: diner, created: false });
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rejects a restaurant account with RESTAURANT_ACCOUNT', async () => {
    const { service, users } = createService();

    const error = await errorOf(
      service.register(registered(UserRole.RESTAURANT_ADMIN), undefined),
    );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      errorCode: 'RESTAURANT_ACCOUNT',
    });
    expect(users.create).not.toHaveBeenCalled();
  });

  it('rejects an unverified email with EMAIL_NOT_VERIFIED', async () => {
    const { service, users } = createService();

    const error = await errorOf(
      service.register(firebase({ emailVerified: false }), undefined),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      errorCode: 'EMAIL_NOT_VERIFIED',
    });
    expect(users.create).not.toHaveBeenCalled();
  });

  it('answers the row created by a concurrent sign-up after a unique conflict', async () => {
    const { service, users } = createService();
    users.create.mockRejectedValue({ code: '23505' });
    users.findByFirebaseUid.mockResolvedValue(diner);

    await expect(service.register(firebase(), undefined)).resolves.toEqual({
      user: diner,
      created: false,
    });
  });

  it('answers the 401 of the login when the email belongs to another account', async () => {
    const { service, users } = createService();
    users.create.mockRejectedValue({ code: '23505' });

    await expect(
      service.register(firebase(), undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propagates errors that are not unique violations', async () => {
    const { service, users } = createService();
    const failure = new Error('database unavailable');
    users.create.mockRejectedValue(failure);

    await expect(service.register(firebase(), undefined)).rejects.toBe(failure);
  });
});
