import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RESTAURANT_REQUIRED_CODE } from '../shared/restaurant-required.js';
import type { UpdateRestaurantDto } from './dto/update-restaurant.dto.js';
import {
  NO_CHANGES_MESSAGE,
  RestaurantEditService,
} from './restaurant-edit.service.js';
import { RestaurantSchedule } from './restaurant-schedule.entity.js';
import { Restaurant } from './restaurant.entity.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';

const storedSchedule = {
  restaurantId: RESTAURANT_ID,
  dayOfWeek: 1,
  isOpen24h: false,
  opensAt: '09:00:00',
  closesAt: '22:00:00',
} as RestaurantSchedule;

// The service works only through the transaction manager; this fake records
// every call so the tests can check that all reads and writes use it.
function createService() {
  const stored: Restaurant = {
    id: RESTAURANT_ID,
    name: 'Nombre anterior',
    category: null,
    address: null,
    isOpen: true,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
  };
  const manager = {
    findOne: vi.fn((_entity: unknown, options: { where: { id: string } }) =>
      Promise.resolve(options.where.id === stored.id ? { ...stored } : null),
    ),
    // Same semantics as EntityManager.merge: later sources win.
    merge: vi.fn(
      (
        _entity: unknown,
        target: Restaurant,
        ...sources: Partial<Restaurant>[]
      ) => Object.assign(target, ...sources),
    ),
    save: vi.fn((entity: object) =>
      Promise.resolve(
        Array.isArray(entity)
          ? entity.map((row: object) => ({ ...row }))
          : { ...entity },
      ),
    ),
    create: vi.fn((_entity: unknown, data: object) => ({ ...data })),
    delete: vi.fn(() => Promise.resolve({ affected: 1 })),
    find: vi.fn(() => Promise.resolve([storedSchedule])),
  };
  const restaurants = {
    manager: {
      transaction: vi.fn(
        (work: (transactionManager: typeof manager) => Promise<unknown>) =>
          work(manager),
      ),
    },
  };
  const service = new RestaurantEditService(
    restaurants as unknown as Repository<Restaurant>,
  );
  return { service, manager, transaction: restaurants.manager.transaction };
}

const mondayToFriday = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  isOpen24h: false,
  opensAt: '09:00',
  closesAt: '22:00',
}));

describe('RestaurantEditService', () => {
  it('updates the name of the session restaurant and returns it', async () => {
    const { service, manager } = createService();

    const { restaurant } = await service.update(RESTAURANT_ID, {
      name: 'La Esquina de Ana',
    });

    expect(manager.findOne).toHaveBeenCalledWith(Restaurant, {
      where: { id: RESTAURANT_ID },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESTAURANT_ID, name: 'La Esquina de Ana' }),
    );
    expect(restaurant).toMatchObject({
      id: RESTAURANT_ID,
      name: 'La Esquina de Ana',
    });
  });

  it('merges only the fields that were sent', async () => {
    const { service, manager } = createService();

    await service.update(RESTAURANT_ID, { name: 'La Esquina de Ana' });

    const [, , changes] = manager.merge.mock.calls[0] as [
      unknown,
      Restaurant,
      Partial<Restaurant>,
    ];
    expect(changes).toEqual({ name: 'La Esquina de Ana' });
  });

  it('leaves the schedules untouched and returns the stored ones when they are not sent', async () => {
    const { service, manager } = createService();

    const { schedules } = await service.update(RESTAURANT_ID, {
      name: 'La Esquina de Ana',
    });

    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.find).toHaveBeenCalledWith(RestaurantSchedule, {
      where: { restaurantId: RESTAURANT_ID },
      order: { dayOfWeek: 'ASC' },
    });
    expect(schedules).toEqual([storedSchedule]);
  });

  it('replaces only the schedules, without saving the restaurant fields', async () => {
    const { service, manager, transaction } = createService();

    const { restaurant, schedules } = await service.update(RESTAURANT_ID, {
      schedules: mondayToFriday,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.merge).not.toHaveBeenCalled();
    expect(manager.delete).toHaveBeenCalledWith(RestaurantSchedule, {
      restaurantId: RESTAURANT_ID,
    });
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(restaurant).toMatchObject({
      id: RESTAURANT_ID,
      name: 'Nombre anterior',
    });
    expect(schedules).toHaveLength(5);
    expect(schedules[0]).toEqual({
      restaurantId: RESTAURANT_ID,
      dayOfWeek: 1,
      isOpen24h: false,
      opensAt: '09:00',
      closesAt: '22:00',
    });
  });

  it('updates fields and schedules in the same transaction, deleting before inserting', async () => {
    const { service, manager, transaction } = createService();

    const { restaurant, schedules } = await service.update(RESTAURANT_ID, {
      name: 'La Esquina de Ana',
      schedules: [{ dayOfWeek: 7, isOpen24h: true }],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(restaurant.name).toBe('La Esquina de Ana');
    expect(schedules).toEqual([
      {
        restaurantId: RESTAURANT_ID,
        dayOfWeek: 7,
        isOpen24h: true,
        opensAt: null,
        closesAt: null,
      },
    ]);
    const deleteOrder = manager.delete.mock.invocationCallOrder[0];
    const insertOrder = manager.save.mock.invocationCallOrder[1];
    expect(deleteOrder).toBeLessThan(insertOrder);
  });

  it('propagates a failed insert out of the transaction, so everything is rolled back', async () => {
    const { service, manager, transaction } = createService();
    manager.save
      .mockImplementationOnce((entity: object) => Promise.resolve(entity))
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      service.update(RESTAURANT_ID, {
        name: 'La Esquina de Ana',
        schedules: mondayToFriday,
      }),
    ).rejects.toThrow('insert failed');
    // Every write went through the transaction manager, so TypeORM rolls back
    // the name and the deleted schedules together with the failed insert.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledTimes(2);
    expect(manager.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes and inserts only for the session restaurant, whatever the data carries', async () => {
    const { service, manager } = createService();
    const tampered = {
      schedules: [
        {
          dayOfWeek: 1,
          isOpen24h: true,
          restaurantId: OTHER_RESTAURANT_ID,
        },
      ],
      restaurantId: OTHER_RESTAURANT_ID,
    } as unknown as UpdateRestaurantDto;

    const { schedules } = await service.update(RESTAURANT_ID, tampered);

    expect(manager.delete).toHaveBeenCalledWith(RestaurantSchedule, {
      restaurantId: RESTAURANT_ID,
    });
    expect(schedules[0].restaurantId).toBe(RESTAURANT_ID);
  });

  it('treats a field sent as undefined as not sent', async () => {
    const { service, manager } = createService();

    await expect(
      service.update(RESTAURANT_ID, { name: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects an empty update with 400 and saves nothing', async () => {
    const { service, manager, transaction } = createService();

    const result = service.update(RESTAURANT_ID, {});

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: { message: [NO_CHANGES_MESSAGE] },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('always updates the session restaurant, even if the data carries another id', async () => {
    const { service, manager } = createService();
    const tampered = {
      name: 'Otro nombre',
      id: OTHER_RESTAURANT_ID,
      restaurantId: OTHER_RESTAURANT_ID,
    } as unknown as UpdateRestaurantDto;

    await service.update(RESTAURANT_ID, tampered);

    expect(manager.findOne).toHaveBeenCalledWith(Restaurant, {
      where: { id: RESTAURANT_ID },
      lock: { mode: 'pessimistic_write' },
    });
    const [saved] = manager.save.mock.calls[0] as [Restaurant];
    expect(saved.id).toBe(RESTAURANT_ID);
  });

  it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED', async () => {
    const { service, manager, transaction } = createService();

    const result = service.update(null, {
      name: 'La Esquina de Ana',
      schedules: mondayToFriday,
    });

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toMatchObject({
      response: { errorCode: RESTAURANT_REQUIRED_CODE },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('fails as an unexpected error if the session restaurant does not exist', async () => {
    const { service, manager } = createService();

    const result = service.update(OTHER_RESTAURANT_ID, {
      name: 'La Esquina de Ana',
    });

    // Not an HttpException: the global filter logs it and answers the generic 500.
    await expect(result).rejects.toThrow('not found');
    await expect(result).rejects.not.toBeInstanceOf(HttpException);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
