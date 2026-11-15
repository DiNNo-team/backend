import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import {
  type RequestIdentity,
  UserRole,
  type UsersService,
} from '../../identity-access/index.js';
import type { SignupRestaurantDto } from './dto/signup-restaurant.dto.js';
import { ALREADY_REGISTERED_MESSAGE } from './restaurant-registration.service.js';
import { RestaurantSchedule } from './restaurant-schedule.entity.js';
import {
  ALREADY_ENABLED_MESSAGE,
  RestaurantSignupService,
} from './restaurant-signup.service.js';
import { Restaurant } from './restaurant.entity.js';

const USER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

const newcomer: RequestIdentity = {
  kind: 'unregistered',
  firebase: {
    uid: 'uid-new',
    email: 'Nueva@Example.com',
    name: 'Ana',
    emailVerified: true,
  },
};

const dto: SignupRestaurantDto = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  latitude: 4.655671,
  longitude: -74.057006,
  contactPhone: '+573001234567',
  schedules: [
    { dayOfWeek: 1, isOpen24h: false, opensAt: '09:00', closesAt: '22:00' },
  ],
};

function registered(
  role: UserRole,
  restaurantId: string | null,
): RequestIdentity {
  return {
    kind: 'registered',
    user: { userId: USER_ID, restaurantId, role, restaurantApproval: null },
  };
}

// Postgres 23505 as TypeORM wraps it.
function uniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key'), {
    driverError: { code: '23505', constraint },
  });
}

function createService(options: { createError?: unknown } = {}) {
  const manager = {
    create: vi.fn((_target: unknown, data: object) => ({ ...data })),
    save: vi.fn((entity: object | object[]) =>
      Promise.resolve(
        Array.isArray(entity) ? entity : { ...entity, id: RESTAURANT_ID },
      ),
    ),
  };
  const transaction = vi.fn(
    (work: (manager: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
  );
  const users = {
    create: vi.fn(() =>
      options.createError
        ? Promise.reject(options.createError)
        : Promise.resolve({ id: USER_ID }),
    ),
    assignRestaurantIfNone: vi.fn().mockResolvedValue(true),
    findByFirebaseUid: vi.fn().mockResolvedValue(null),
  };
  const service = new RestaurantSignupService(
    { manager: { transaction } } as unknown as Repository<Restaurant>,
    users as unknown as UsersService,
  );
  return { service, manager, transaction, users };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected a rejection');
}

describe('RestaurantSignupService', () => {
  it('creates the user, the pending restaurant, its schedules and the link in one transaction', async () => {
    const { service, manager, transaction, users } = createService();

    const result = await service.signup(newcomer, dto);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(users.create).toHaveBeenCalledWith(
      {
        firebaseUid: 'uid-new',
        email: 'Nueva@Example.com',
        role: UserRole.RESTAURANT_ADMIN,
        restaurantId: null,
        displayName: null,
      },
      manager,
    );
    expect(manager.create).toHaveBeenCalledWith(Restaurant, {
      name: 'La Esquina de Ana',
      category: 'colombian',
      address: 'Calle 72 # 10-34, Bogotá',
      latitude: 4.655671,
      longitude: -74.057006,
      contactPhone: '+573001234567',
      approvalStatus: 'pending',
    });
    expect(manager.create).toHaveBeenCalledWith(RestaurantSchedule, {
      restaurantId: RESTAURANT_ID,
      dayOfWeek: 1,
      isOpen24h: false,
      opensAt: '09:00',
      closesAt: '22:00',
    });
    expect(users.assignRestaurantIfNone).toHaveBeenCalledWith(
      USER_ID,
      RESTAURANT_ID,
      manager,
    );
    expect(result.restaurant).toMatchObject({
      id: RESTAURANT_ID,
      approvalStatus: 'pending',
    });
  });

  it('creates the user before anything else, so a duplicate account fails first', async () => {
    const { service, manager, users } = createService({
      createError: uniqueViolation('UQ_users_firebase_uid'),
    });
    users.findByFirebaseUid.mockResolvedValue({
      id: USER_ID,
      role: UserRole.RESTAURANT_ADMIN,
      restaurantId: RESTAURANT_ID,
    });

    await rejection(service.signup(newcomer, dto));

    expect(manager.save).not.toHaveBeenCalled();
  });

  describe('an account that already exists: nothing is created', () => {
    it.each([
      ['a diner', registered(UserRole.DINER, null), 'DINER_ACCOUNT'],
      [
        'a DiNNo admin',
        registered(UserRole.PLATFORM_ADMIN, null),
        'ADMIN_ACCOUNT',
      ],
    ])('%s → 403 %s', async (_case, identity, code) => {
      const { service, transaction } = createService();

      const error = await rejection(service.signup(identity, dto));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        errorCode: code,
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['with a restaurant', RESTAURANT_ID, ALREADY_REGISTERED_MESSAGE],
      ['enabled by hand, without a restaurant', null, ALREADY_ENABLED_MESSAGE],
    ])(
      'a restaurant_admin %s → 409 without errorCode',
      async (_case, restaurantId, message) => {
        const { service, transaction } = createService();

        const error = await rejection(
          service.signup(
            registered(UserRole.RESTAURANT_ADMIN, restaurantId),
            dto,
          ),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({
          statusCode: 409,
          message,
          error: 'Conflict',
        });
        expect(transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('two sign-ups of the same account at once', () => {
    it.each(['UQ_users_firebase_uid', 'UQ_users_email'])(
      'the loser of %s gets the 409 of the account the winner created',
      async (constraint) => {
        const { service, users } = createService({
          createError: uniqueViolation(constraint),
        });
        users.findByFirebaseUid.mockResolvedValue({
          id: USER_ID,
          role: UserRole.RESTAURANT_ADMIN,
          restaurantId: RESTAURANT_ID,
        });

        const error = await rejection(service.signup(newcomer, dto));

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(ALREADY_REGISTERED_MESSAGE);
        expect(users.findByFirebaseUid).toHaveBeenCalledWith('uid-new');
      },
    );

    it('the loser against a diner sign-up of the same account gets DINER_ACCOUNT', async () => {
      const { service, users } = createService({
        createError: uniqueViolation('UQ_users_firebase_uid'),
      });
      users.findByFirebaseUid.mockResolvedValue({
        id: USER_ID,
        role: UserRole.DINER,
        restaurantId: null,
      });

      const error = await rejection(service.signup(newcomer, dto));

      expect((error as ForbiddenException).getResponse()).toMatchObject({
        errorCode: 'DINER_ACCOUNT',
      });
    });

    it('an email that belongs to another Firebase account answers the 401 of the login', async () => {
      const { service } = createService({
        createError: uniqueViolation('UQ_users_email'),
      });

      const error = await rejection(service.signup(newcomer, dto));

      expect(error).toBeInstanceOf(UnauthorizedException);
    });

    it('any other error passes unchanged (the global filter answers 500)', async () => {
      const failure = new Error('connection lost');
      const { service, users } = createService({ createError: failure });

      await expect(service.signup(newcomer, dto)).rejects.toBe(failure);
      expect(users.findByFirebaseUid).not.toHaveBeenCalled();
    });

    it('a unique violation of another constraint is not taken as a duplicate account', async () => {
      const failure = uniqueViolation('UQ_restaurant_schedules_day');
      const { service, users } = createService({ createError: failure });

      await expect(service.signup(newcomer, dto)).rejects.toBe(failure);
      expect(users.findByFirebaseUid).not.toHaveBeenCalled();
    });
  });

  it('rejects an unverified account (defense in depth: the resolver guarantees it)', async () => {
    const { service, transaction } = createService();

    const error = await rejection(
      service.signup(
        {
          kind: 'unregistered',
          firebase: {
            ...(newcomer.kind === 'unregistered' && newcomer.firebase),
            emailVerified: false,
          } as never,
        },
        dto,
      ),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
