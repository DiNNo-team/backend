import type { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Clock } from '../../../common/time/clock.js';
import type { RestaurantApprovalStatus } from '../../identity-access/index.js';
import {
  availabilityAffected,
  RESTAURANT_AVAILABILITY_AFFECTED,
} from '../shared/availability-affected.event.js';
import {
  RESTAURANT_NOT_FOUND_CODE,
  RESTAURANT_NOT_FOUND_MESSAGE,
} from '../shared/restaurant-not-found.js';
import type { Restaurant } from '../restaurants/restaurant.entity.js';
import { RestaurantReviewService } from './restaurant-review.service.js';
import {
  RESTAURANT_NOT_PENDING_CODE,
  RESTAURANT_NOT_PENDING_MESSAGE,
} from './review-errors.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const UNKNOWN_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const ADMIN_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3';
// 2026-11-15 09:30 en Bogotá.
const NOW = new Date('2026-11-15T14:30:00Z');

type Stored = Pick<
  Restaurant,
  'id' | 'approvalStatus' | 'rejectionReason' | 'reviewedBy' | 'reviewedAt'
>;

function createService(status: RestaurantApprovalStatus = 'pending') {
  const stored: Stored = {
    id: RESTAURANT_ID,
    approvalStatus: status,
    rejectionReason:
      status === 'rejected' ? 'Motivo anterior del rechazo.' : null,
    reviewedBy: null,
    reviewedAt: null,
  };
  const restaurants = {
    // Misma semántica que el UPDATE condicional: cambia solo si coincide el id y
    // sigue pendiente, en la misma llamada (una sola sentencia en Postgres).
    update: vi.fn(
      (
        where: { id: string; approvalStatus: RestaurantApprovalStatus },
        changes: Partial<Stored>,
      ) => {
        const matches =
          where.id === stored.id &&
          stored.approvalStatus === where.approvalStatus;
        if (matches) {
          Object.assign(stored, changes);
        }
        return Promise.resolve({ affected: matches ? 1 : 0 });
      },
    ),
    existsBy: vi.fn(({ id }: { id: string }) =>
      Promise.resolve(id === stored.id),
    ),
  };
  const events = { emit: vi.fn() };
  const clock: Clock = { now: () => NOW };
  const service = new RestaurantReviewService(
    restaurants as unknown as Repository<Restaurant>,
    clock,
    events as unknown as EventEmitter2,
  );
  return { service, stored, restaurants, events };
}

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  return {
    status: (error as HttpException).getStatus(),
    body: (error as HttpException).getResponse(),
  };
}

describe('RestaurantReviewService', () => {
  describe('approve', () => {
    it('approves a pending restaurant, records who and when, and clears the reason', async () => {
      const { service, stored, restaurants } = createService();

      await service.approve(ADMIN_ID, RESTAURANT_ID);

      expect(stored).toEqual({
        id: RESTAURANT_ID,
        approvalStatus: 'approved',
        rejectionReason: null,
        reviewedBy: ADMIN_ID,
        reviewedAt: NOW,
      });
      // Una sola sentencia condicional: solo desde pending.
      expect(restaurants.update).toHaveBeenCalledWith(
        { id: RESTAURANT_ID, approvalStatus: 'pending' },
        expect.any(Object),
      );
    });

    it('emits the availability event after saving, so the restaurant can appear to diners', async () => {
      const { service, events } = createService();

      await service.approve(ADMIN_ID, RESTAURANT_ID);

      expect(events.emit).toHaveBeenCalledExactlyOnceWith(
        RESTAURANT_AVAILABILITY_AFFECTED,
        availabilityAffected(RESTAURANT_ID),
      );
    });

    it.each(['approved', 'rejected'] as const)(
      'answers 409 RESTAURANT_NOT_PENDING from %s, without changes or events',
      async (status) => {
        const { service, stored, events } = createService(status);
        const before = { ...stored };

        expect(await errorOf(service.approve(ADMIN_ID, RESTAURANT_ID))).toEqual(
          {
            status: 409,
            body: {
              statusCode: 409,
              message: RESTAURANT_NOT_PENDING_MESSAGE,
              error: 'Conflict',
              errorCode: RESTAURANT_NOT_PENDING_CODE,
            },
          },
        );
        expect(stored).toEqual(before);
        expect(events.emit).not.toHaveBeenCalled();
      },
    );

    it('answers 404 RESTAURANT_NOT_FOUND for an unknown restaurant', async () => {
      const { service, events } = createService();

      expect(await errorOf(service.approve(ADMIN_ID, UNKNOWN_ID))).toEqual({
        status: 404,
        body: {
          statusCode: 404,
          message: RESTAURANT_NOT_FOUND_MESSAGE,
          error: 'Not Found',
          errorCode: RESTAURANT_NOT_FOUND_CODE,
        },
      });
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('two approvals of the same request: one wins, the other gets 409', async () => {
      const { service, stored } = createService();

      const results = await Promise.allSettled([
        service.approve(ADMIN_ID, RESTAURANT_ID),
        service.approve(ADMIN_ID, RESTAURANT_ID),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(stored.approvalStatus).toBe('approved');
    });
  });

  describe('reject', () => {
    it('rejects a pending restaurant with the reason, who and when', async () => {
      const { service, stored } = createService();

      await service.reject(
        ADMIN_ID,
        RESTAURANT_ID,
        'La dirección no coincide con el local.',
      );

      expect(stored).toEqual({
        id: RESTAURANT_ID,
        approvalStatus: 'rejected',
        rejectionReason: 'La dirección no coincide con el local.',
        reviewedBy: ADMIN_ID,
        reviewedAt: NOW,
      });
    });

    it('emits nothing: a rejected restaurant was never visible', async () => {
      const { service, events } = createService();

      await service.reject(ADMIN_ID, RESTAURANT_ID, 'Faltan datos del local.');

      expect(events.emit).not.toHaveBeenCalled();
    });

    it.each(['approved', 'rejected'] as const)(
      'answers 409 RESTAURANT_NOT_PENDING from %s and keeps the previous audit',
      async (status) => {
        const { service, stored } = createService(status);
        const before = { ...stored };

        expect(
          (
            await errorOf(
              service.reject(
                ADMIN_ID,
                RESTAURANT_ID,
                'Otro motivo cualquiera.',
              ),
            )
          ).status,
        ).toBe(409);
        expect(stored).toEqual(before);
      },
    );

    it('answers 404 for an unknown restaurant', async () => {
      const { service } = createService();

      expect(
        (
          await errorOf(
            service.reject(ADMIN_ID, UNKNOWN_ID, 'Faltan datos del local.'),
          )
        ).status,
      ).toBe(404);
    });
  });
});
