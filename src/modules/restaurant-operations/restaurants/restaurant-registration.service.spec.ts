import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import type {
  CurrentUserData,
  UsersService,
} from '../../identity-access/index.js';
import type { RegisterRestaurantDto } from './dto/register-restaurant.dto.js';
import {
  ALREADY_REGISTERED_MESSAGE,
  RestaurantRegistrationService,
} from './restaurant-registration.service.js';
import { RestaurantSchedule } from './restaurant-schedule.entity.js';
import { Restaurant } from './restaurant.entity.js';

const USER_ID = '2f3e4d5c-6b7a-4980-a1b2-c3d4e5f60718';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

const newcomer: CurrentUserData = {
  userId: USER_ID,
  restaurantId: null,
  role: 'restaurant_admin',
};

const dto: RegisterRestaurantDto = {
  name: 'La Esquina de Ana',
  category: 'colombian',
  address: 'Calle 72 # 10-34, Bogotá',
  schedules: [
    { dayOfWeek: 1, isOpen24h: false, opensAt: '09:00', closesAt: '22:00' },
    { dayOfWeek: 6, isOpen24h: true },
  ],
};

function createService(options: { linked?: boolean } = {}) {
  // What register sees inside its transaction: create returns a plain copy of
  // the data and save gives the restaurant its id.
  const manager = {
    create: vi.fn((_target: unknown, data: object) => ({ ...data })),
    save: vi.fn((entity: object | object[]) =>
      Promise.resolve(
        Array.isArray(entity) ? entity : { id: RESTAURANT_ID, ...entity },
      ),
    ),
  };
  const restaurants = {
    findOneBy: vi.fn(),
    manager: {
      transaction: vi.fn((work: (manager: EntityManager) => unknown) =>
        work(manager as unknown as EntityManager),
      ),
    },
  };
  const schedules = { find: vi.fn() };
  const users = {
    assignRestaurantIfNone: vi.fn().mockResolvedValue(options.linked ?? true),
  };
  const service = new RestaurantRegistrationService(
    restaurants as unknown as Repository<Restaurant>,
    schedules as unknown as Repository<RestaurantSchedule>,
    users as unknown as UsersService,
  );
  return { service, manager, restaurants, schedules, users };
}

describe('RestaurantRegistrationService', () => {
  describe('register', () => {
    it('creates the restaurant with its schedules and links it to the session user', async () => {
      const { service, manager, users } = createService();

      const result = await service.register(newcomer, dto);

      expect(manager.create).toHaveBeenCalledWith(Restaurant, {
        name: 'La Esquina de Ana',
        category: 'colombian',
        address: 'Calle 72 # 10-34, Bogotá',
      });
      expect(result.restaurant.id).toBe(RESTAURANT_ID);
      expect(result.schedules).toEqual([
        {
          restaurantId: RESTAURANT_ID,
          dayOfWeek: 1,
          isOpen24h: false,
          opensAt: '09:00',
          closesAt: '22:00',
        },
        {
          restaurantId: RESTAURANT_ID,
          dayOfWeek: 6,
          isOpen24h: true,
          opensAt: null,
          closesAt: null,
        },
      ]);
      expect(users.assignRestaurantIfNone).toHaveBeenCalledWith(
        USER_ID,
        RESTAURANT_ID,
        manager,
      );
    });

    it('saves the schedules as RestaurantSchedule rows', async () => {
      const { service, manager } = createService();

      await service.register(newcomer, dto);

      expect(manager.create).toHaveBeenCalledWith(
        RestaurantSchedule,
        expect.objectContaining({ restaurantId: RESTAURANT_ID, dayOfWeek: 1 }),
      );
    });

    it('answers 409 without opening a transaction for a user who already has a restaurant', async () => {
      const { service, restaurants, users } = createService();

      const register = service.register(
        { ...newcomer, restaurantId: RESTAURANT_ID },
        dto,
      );

      await expect(register).rejects.toBeInstanceOf(ConflictException);
      await expect(register).rejects.toThrow(ALREADY_REGISTERED_MESSAGE);
      expect(restaurants.manager.transaction).not.toHaveBeenCalled();
      expect(users.assignRestaurantIfNone).not.toHaveBeenCalled();
    });

    it('answers 409 inside the transaction when the user got a restaurant meanwhile, so it is rolled back', async () => {
      const { service, restaurants } = createService({ linked: false });

      await expect(service.register(newcomer, dto)).rejects.toThrow(
        new ConflictException(ALREADY_REGISTERED_MESSAGE),
      );
      expect(restaurants.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('propagates a failure of the link, so the transaction is rolled back', async () => {
      const { service, users } = createService();
      users.assignRestaurantIfNone.mockRejectedValue(
        new Error('database down'),
      );

      await expect(service.register(newcomer, dto)).rejects.toThrow(
        'database down',
      );
    });
  });

  describe('findMine', () => {
    it('returns the session restaurant with its schedules from Monday to Sunday', async () => {
      const { service, restaurants, schedules } = createService();
      const restaurant = { id: RESTAURANT_ID, name: 'La Esquina de Ana' };
      restaurants.findOneBy.mockResolvedValue(restaurant);
      schedules.find.mockResolvedValue([]);

      await expect(service.findMine(RESTAURANT_ID)).resolves.toEqual({
        restaurant,
        schedules: [],
      });
      expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
      expect(schedules.find).toHaveBeenCalledWith({
        where: { restaurantId: RESTAURANT_ID },
        order: { dayOfWeek: 'ASC' },
      });
    });

    it('answers 403 RESTAURANT_REQUIRED for a user without a restaurant', async () => {
      const { service, restaurants } = createService();

      await expect(service.findMine(null)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(restaurants.findOneBy).not.toHaveBeenCalled();
    });

    it('fails with an unhandled error (generic 500) if the restaurant is missing', async () => {
      const { service, restaurants, schedules } = createService();
      restaurants.findOneBy.mockResolvedValue(null);

      await expect(service.findMine(RESTAURANT_ID)).rejects.toThrow(
        `Restaurant ${RESTAURANT_ID} of the session user not found`,
      );
      expect(schedules.find).not.toHaveBeenCalled();
    });
  });
});
