import { ForbiddenException, HttpException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { RESTAURANT_REQUIRED_CODE } from '../shared/restaurant-required.js';
import { RestaurantStatusService } from './restaurant-status.service.js';
import type { Restaurant } from './restaurant.entity.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const OTHER_RESTAURANT_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';

function createService() {
  const stored: Restaurant = {
    id: RESTAURANT_ID,
    name: 'La Esquina de Ana',
    category: null,
    address: null,
    isOpen: true,
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
  const service = new RestaurantStatusService(
    restaurants as unknown as Repository<Restaurant>,
  );
  return { service, restaurants };
}

describe('RestaurantStatusService', () => {
  describe('get', () => {
    it('returns the session restaurant', async () => {
      const { service, restaurants } = createService();

      const restaurant = await service.get(RESTAURANT_ID);

      expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
      expect(restaurant).toMatchObject({ id: RESTAURANT_ID, isOpen: true });
    });

    it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED', async () => {
      const { service, restaurants } = createService();

      const result = service.get(null);

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toMatchObject({
        response: { errorCode: RESTAURANT_REQUIRED_CODE },
      });
      expect(restaurants.findOneBy).not.toHaveBeenCalled();
    });

    it('fails as an unexpected error if the session restaurant does not exist', async () => {
      const { service } = createService();

      const result = service.get(OTHER_RESTAURANT_ID);

      // Not an HttpException: the global filter logs it and answers the generic 500.
      await expect(result).rejects.toThrow('not found');
      await expect(result).rejects.not.toBeInstanceOf(HttpException);
    });
  });

  describe('update', () => {
    it('closes the session restaurant and returns it', async () => {
      const { service, restaurants } = createService();

      const restaurant = await service.update(RESTAURANT_ID, false);

      expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
      expect(restaurants.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: RESTAURANT_ID, isOpen: false }),
      );
      expect(restaurant).toMatchObject({ id: RESTAURANT_ID, isOpen: false });
    });

    it('changes only isOpen', async () => {
      const { service } = createService();

      const restaurant = await service.update(RESTAURANT_ID, false);

      expect(restaurant).toMatchObject({
        name: 'La Esquina de Ana',
        category: null,
        address: null,
      });
    });

    it('answers the same state without failing', async () => {
      const { service } = createService();

      await expect(service.update(RESTAURANT_ID, true)).resolves.toMatchObject({
        isOpen: true,
      });
    });

    it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED', async () => {
      const { service, restaurants } = createService();

      const result = service.update(null, false);

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toMatchObject({
        response: { errorCode: RESTAURANT_REQUIRED_CODE },
      });
      expect(restaurants.save).not.toHaveBeenCalled();
    });

    it('fails as an unexpected error if the session restaurant does not exist', async () => {
      const { service, restaurants } = createService();

      const result = service.update(OTHER_RESTAURANT_ID, false);

      await expect(result).rejects.toThrow('not found');
      await expect(result).rejects.not.toBeInstanceOf(HttpException);
      expect(restaurants.save).not.toHaveBeenCalled();
    });
  });
});
