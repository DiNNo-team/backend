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
import type { Restaurant } from './restaurant.entity.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';

function createService() {
  const stored: Restaurant = {
    id: RESTAURANT_ID,
    name: 'Nombre anterior',
    category: null,
    address: null,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
  };
  const restaurants = {
    findOneBy: vi.fn(({ id }: { id: string }) =>
      Promise.resolve(id === stored.id ? { ...stored } : null),
    ),
    // Same semantics as Repository.merge: later sources win.
    merge: vi.fn((target: Restaurant, ...sources: Partial<Restaurant>[]) =>
      Object.assign(target, ...sources),
    ),
    save: vi.fn((restaurant: Restaurant) => Promise.resolve({ ...restaurant })),
  };
  const service = new RestaurantEditService(
    restaurants as unknown as Repository<Restaurant>,
  );
  return { service, restaurants };
}

describe('RestaurantEditService', () => {
  it('updates the name of the session restaurant and returns it', async () => {
    const { service, restaurants } = createService();

    const restaurant = await service.update(RESTAURANT_ID, {
      name: 'La Esquina de Ana',
    });

    expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
    expect(restaurants.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: RESTAURANT_ID, name: 'La Esquina de Ana' }),
    );
    expect(restaurant).toMatchObject({
      id: RESTAURANT_ID,
      name: 'La Esquina de Ana',
    });
  });

  it('merges only the fields that were sent', async () => {
    const { service, restaurants } = createService();

    await service.update(RESTAURANT_ID, { name: 'La Esquina de Ana' });

    const [, changes] = restaurants.merge.mock.calls[0] as [
      Restaurant,
      Partial<Restaurant>,
    ];
    expect(changes).toEqual({ name: 'La Esquina de Ana' });
  });

  it('treats a field sent as undefined as not sent', async () => {
    const { service, restaurants } = createService();

    await expect(
      service.update(RESTAURANT_ID, { name: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it('rejects an empty update with 400 and saves nothing', async () => {
    const { service, restaurants } = createService();

    const result = service.update(RESTAURANT_ID, {});

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toMatchObject({
      response: { message: [NO_CHANGES_MESSAGE] },
    });
    expect(restaurants.findOneBy).not.toHaveBeenCalled();
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it('always updates the session restaurant, even if the data carries another id', async () => {
    const { service, restaurants } = createService();
    const tampered = {
      name: 'Otro nombre',
      id: OTHER_RESTAURANT_ID,
      restaurantId: OTHER_RESTAURANT_ID,
    } as unknown as UpdateRestaurantDto;

    await service.update(RESTAURANT_ID, tampered);

    expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
    const [saved] = restaurants.save.mock.calls[0] as [Restaurant];
    expect(saved.id).toBe(RESTAURANT_ID);
  });

  it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED', async () => {
    const { service, restaurants } = createService();

    const result = service.update(null, { name: 'La Esquina de Ana' });

    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(result).rejects.toMatchObject({
      response: { errorCode: RESTAURANT_REQUIRED_CODE },
    });
    expect(restaurants.save).not.toHaveBeenCalled();
  });

  it('fails as an unexpected error if the session restaurant does not exist', async () => {
    const { service, restaurants } = createService();

    const result = service.update(OTHER_RESTAURANT_ID, {
      name: 'La Esquina de Ana',
    });

    // Not an HttpException: the global filter logs it and answers the generic 500.
    await expect(result).rejects.toThrow('not found');
    await expect(result).rejects.not.toBeInstanceOf(HttpException);
    expect(restaurants.save).not.toHaveBeenCalled();
  });
});
