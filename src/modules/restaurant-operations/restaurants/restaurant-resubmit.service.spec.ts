import { HttpException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { RestaurantApprovalStatus } from '../../identity-access/index.js';
import { RESTAURANT_REQUIRED_CODE } from '../shared/restaurant-required.js';
import {
  RESTAURANT_NOT_REJECTED_CODE,
  RESTAURANT_NOT_REJECTED_MESSAGE,
  RestaurantResubmitService,
} from './restaurant-resubmit.service.js';
import type { Restaurant } from './restaurant.entity.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const ADMIN_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3';
const NOW = new Date('2026-11-15T14:30:00Z');

type Stored = Pick<
  Restaurant,
  | 'approvalStatus'
  | 'rejectionReason'
  | 'reviewedBy'
  | 'reviewedAt'
  | 'submittedAt'
>;

function createService(status: RestaurantApprovalStatus) {
  const stored: Stored = {
    approvalStatus: status,
    rejectionReason: status === 'rejected' ? 'Faltan datos del local.' : null,
    reviewedBy: status === 'pending' ? null : ADMIN_ID,
    reviewedAt: status === 'pending' ? null : new Date('2026-11-14T10:00:00Z'),
    submittedAt: new Date('2026-11-13T10:00:00Z'),
  };
  const restaurants = {
    // UPDATE condicional: cambia solo si coincide el id y el estado.
    update: vi.fn(
      (
        where: { id: string; approvalStatus: RestaurantApprovalStatus },
        changes: Partial<Stored>,
      ) => {
        const matches =
          where.id === RESTAURANT_ID &&
          stored.approvalStatus === where.approvalStatus;
        if (matches) {
          Object.assign(stored, changes);
        }
        return Promise.resolve({ affected: matches ? 1 : 0 });
      },
    ),
  };
  const service = new RestaurantResubmitService(
    restaurants as unknown as Repository<Restaurant>,
    { now: () => NOW },
  );
  return { service, stored, restaurants };
}

describe('RestaurantResubmitService', () => {
  it('rejected → pending, clears the review and moves submittedAt to now', async () => {
    const { service, stored, restaurants } = createService('rejected');

    await service.resubmit(RESTAURANT_ID);

    expect(stored).toEqual({
      approvalStatus: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
      submittedAt: NOW,
    });
    expect(restaurants.update).toHaveBeenCalledWith(
      { id: RESTAURANT_ID, approvalStatus: 'rejected' },
      expect.any(Object),
    );
  });

  it.each(['pending', 'approved'] as const)(
    'from %s answers 409 RESTAURANT_NOT_REJECTED without changes',
    async (status) => {
      const { service, stored } = createService(status);
      const before = { ...stored };

      const error = await service
        .resubmit(RESTAURANT_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({
        statusCode: 409,
        message: RESTAURANT_NOT_REJECTED_MESSAGE,
        error: 'Conflict',
        errorCode: RESTAURANT_NOT_REJECTED_CODE,
      });
      expect(stored).toEqual(before);
    },
  );

  it('two resubmits at once: one wins, the other gets 409', async () => {
    const { service } = createService('rejected');

    const results = await Promise.allSettled([
      service.resubmit(RESTAURANT_ID),
      service.resubmit(RESTAURANT_ID),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
  });

  it('without a restaurant answers RESTAURANT_REQUIRED', async () => {
    const { service } = createService('rejected');

    const error = await service.resubmit(null).catch((caught) => caught);

    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: RESTAURANT_REQUIRED_CODE,
    });
  });
});
