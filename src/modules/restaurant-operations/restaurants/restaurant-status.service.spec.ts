import type { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException, HttpException } from '@nestjs/common';
import { Not, type FindOperator, type Repository } from 'typeorm';
import {
  availabilityAffected,
  RESTAURANT_AVAILABILITY_AFFECTED,
} from '../shared/availability-affected.event.js';
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
    latitude: null,
    longitude: null,
    createdAt: new Date('2026-10-04T12:00:00Z'),
    updatedAt: new Date('2026-10-04T12:00:00Z'),
  };
  const restaurants = {
    findOneBy: vi.fn(({ id }: { id: string }) =>
      Promise.resolve(id === stored.id ? { ...stored } : null),
    ),
    // Same semantics as the conditional Repository.update: the row changes
    // (affected 1) only if it matches the id and isOpen is Not(the new
    // value); only the given columns change. Checked and written in the same
    // call, like the single statement in Postgres.
    update: vi.fn(
      (
        { id, isOpen }: { id: string; isOpen: FindOperator<boolean> },
        changes: Partial<Restaurant>,
      ) => {
        const matches = id === stored.id && stored.isOpen !== isOpen.value;
        if (matches) {
          Object.assign(stored, changes);
        }
        return Promise.resolve({ affected: matches ? 1 : 0 });
      },
    ),
  };
  const events = { emit: vi.fn() };
  const service = new RestaurantStatusService(
    restaurants as unknown as Repository<Restaurant>,
    events as unknown as EventEmitter2,
  );
  return { service, restaurants, events };
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

      // One conditional statement: only if isOpen is not already false.
      expect(restaurants.update).toHaveBeenCalledTimes(1);
      expect(restaurants.update).toHaveBeenCalledWith(
        { id: RESTAURANT_ID, isOpen: Not(false) },
        { isOpen: false },
      );
      // The answer is the row read back after the update.
      expect(restaurants.findOneBy).toHaveBeenCalledWith({ id: RESTAURANT_ID });
      expect(restaurant).toMatchObject({ id: RESTAURANT_ID, isOpen: false });
    });

    it('changes only isOpen', async () => {
      const { service, restaurants } = createService();

      const restaurant = await service.update(RESTAURANT_ID, false);

      // Only isOpen is written: a stale name, category or address is never sent.
      const [, changes] = restaurants.update.mock.calls[0] as [
        unknown,
        Partial<Restaurant>,
      ];
      expect(changes).toEqual({ isOpen: false });
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

    it('emits the availability event once on a real change', async () => {
      const { service, events } = createService();

      await service.update(RESTAURANT_ID, false);

      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        availabilityAffected(RESTAURANT_ID),
      );
    });

    it('does not emit for the state it already has (affected 0)', async () => {
      const { service, restaurants, events } = createService();

      await service.update(RESTAURANT_ID, true);

      await expect(restaurants.update.mock.results[0].value).resolves.toEqual({
        affected: 0,
      });
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('emits once for two simultaneous requests with the same new state', async () => {
      const { service, restaurants, events } = createService();

      const [first, second] = await Promise.all([
        service.update(RESTAURANT_ID, false),
        service.update(RESTAURANT_ID, false),
      ]);

      // The second statement finds the row already closed: affected 0.
      expect(restaurants.update).toHaveBeenCalledTimes(2);
      await expect(restaurants.update.mock.results[1].value).resolves.toEqual({
        affected: 0,
      });
      expect(events.emit).toHaveBeenCalledTimes(1);
      // Both answer the final state.
      expect(first).toMatchObject({ isOpen: false });
      expect(second).toMatchObject({ isOpen: false });
    });

    it('does not emit when the write fails', async () => {
      const { service, restaurants, events } = createService();
      restaurants.update.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.update(RESTAURANT_ID, false)).rejects.toThrow(
        'connection lost',
      );
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('rejects a user without a restaurant with 403 RESTAURANT_REQUIRED', async () => {
      const { service, restaurants } = createService();

      const result = service.update(null, false);

      await expect(result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(result).rejects.toMatchObject({
        response: { errorCode: RESTAURANT_REQUIRED_CODE },
      });
      expect(restaurants.update).not.toHaveBeenCalled();
    });

    it('fails as an unexpected error if the session restaurant does not exist', async () => {
      const { service, events } = createService();

      const result = service.update(OTHER_RESTAURANT_ID, false);

      await expect(result).rejects.toThrow('not found');
      await expect(result).rejects.not.toBeInstanceOf(HttpException);
      // The conditional statement matches no row (affected 0): nothing is
      // written or emitted, and the read of the final state fails.
      expect(events.emit).not.toHaveBeenCalled();
    });
  });
});
