import { HttpException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { UsersService } from '../../identity-access/index.js';
import { RESTAURANT_NOT_FOUND_CODE } from '../shared/restaurant-not-found.js';
import type { RestaurantSchedule } from '../restaurants/restaurant-schedule.entity.js';
import type { Restaurant } from '../restaurants/restaurant.entity.js';
import {
  adminListOrder,
  RestaurantReviewQueries,
} from './restaurant-review.queries.js';

const PENDING_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const REJECTED_ID = '1d2c3b4a-5f6e-4d7c-8b9a-0a1b2c3d4e5f';
const ADMIN_ID = 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f708192a3';
const SECOND_ADMIN_ID = 'b8c9d0e1-f2a3-4b4c-9d5e-6f708192a3b4';

function restaurant(fields: Partial<Restaurant>): Restaurant {
  return {
    id: PENDING_ID,
    name: 'La Esquina de Ana',
    category: 'colombian',
    address: 'Calle 72 # 10-34, Bogotá',
    isOpen: true,
    latitude: 4.655671,
    longitude: -74.057006,
    approvalStatus: 'pending',
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    suspensionReason: null,
    suspendedAt: null,
    suspendedBy: null,
    contactPhone: '+573001234567',
    submittedAt: new Date('2026-11-14T15:00:00Z'),
    createdAt: new Date('2026-11-14T15:00:00Z'),
    updatedAt: new Date('2026-11-14T15:00:00Z'),
    ...fields,
  };
}

function createQueries(rows: Restaurant[], total = rows.length) {
  const restaurants = {
    findAndCount: vi.fn(() => Promise.resolve([rows, total])),
    findOneBy: vi.fn(({ id }: { id: string }) =>
      Promise.resolve(rows.find((row) => row.id === id) ?? null),
    ),
  };
  const schedules = {
    find: vi.fn(() =>
      Promise.resolve([
        {
          dayOfWeek: 6,
          isOpen24h: true,
          opensAt: null,
          closesAt: null,
        },
        {
          dayOfWeek: 1,
          isOpen24h: false,
          opensAt: '09:00:00',
          closesAt: '22:00:00',
        },
      ] as RestaurantSchedule[]),
    ),
  };
  const users = {
    findRestaurantOwnerEmails: vi.fn((ids: string[]) =>
      Promise.resolve(
        new Map(
          ids
            .filter((id) => id === PENDING_ID || id === REJECTED_ID)
            .map((id) => [id, `duena-${id.slice(0, 4)}@example.com`]),
        ),
      ),
    ),
    findPlatformAdminEmailsByIds: vi.fn((ids: string[]) =>
      Promise.resolve(
        new Map(
          ids
            .filter((id) => id === ADMIN_ID || id === SECOND_ADMIN_ID)
            .map((id) => [
              id,
              id === ADMIN_ID ? 'admin@example.com' : 'otro.admin@example.com',
            ]),
        ),
      ),
    ),
  };
  const queries = new RestaurantReviewQueries(
    restaurants as unknown as Repository<Restaurant>,
    schedules as unknown as Repository<RestaurantSchedule>,
    users as unknown as UsersService,
  );
  return { queries, restaurants, users };
}

describe('adminListOrder', () => {
  it('pending: the one waiting longest first', () => {
    expect(adminListOrder('pending')).toEqual({
      submittedAt: 'ASC',
      id: 'ASC',
    });
  });

  it.each(['approved', 'rejected'] as const)(
    '%s: the latest review first, never-reviewed ones last',
    (status) => {
      expect(adminListOrder(status)).toEqual({
        reviewedAt: { direction: 'DESC', nulls: 'LAST' },
        submittedAt: 'DESC',
        id: 'ASC',
      });
    },
  );
});

describe('adminListOrder (suspended)', () => {
  it('suspended: the latest suspension first', () => {
    expect(adminListOrder('suspended')).toEqual({
      suspendedAt: 'DESC',
      id: 'ASC',
    });
  });
});

describe('RestaurantReviewQueries', () => {
  it('the detail shows the last suspension with both admin emails from one query', async () => {
    const { queries, users } = createQueries([
      restaurant({
        approvalStatus: 'suspended',
        reviewedBy: ADMIN_ID,
        reviewedAt: new Date('2026-11-02T15:00:00Z'),
        suspensionReason: 'Varios comensales reportaron mesas inexistentes.',
        suspendedBy: SECOND_ADMIN_ID,
        suspendedAt: new Date('2026-11-16T20:00:00Z'),
      }),
    ]);

    const detail = await queries.detail(PENDING_ID);

    expect(detail).toMatchObject({
      approvalStatus: 'suspended',
      reviewedByEmail: 'admin@example.com',
      suspensionReason: 'Varios comensales reportaron mesas inexistentes.',
      suspendedAt: '2026-11-16T20:00:00.000Z',
      suspendedByEmail: 'otro.admin@example.com',
    });
    expect(users.findPlatformAdminEmailsByIds).toHaveBeenCalledExactlyOnceWith([
      ADMIN_ID,
      SECOND_ADMIN_ID,
    ]);
  });

  it('a reactivated restaurant keeps its last suspension in the admin detail', async () => {
    const { queries } = createQueries([
      restaurant({
        approvalStatus: 'approved',
        suspensionReason: 'Motivo de la última suspensión.',
        suspendedBy: ADMIN_ID,
        suspendedAt: new Date('2026-11-16T20:00:00Z'),
      }),
    ]);

    expect(await queries.detail(PENDING_ID)).toMatchObject({
      approvalStatus: 'approved',
      suspensionReason: 'Motivo de la última suspensión.',
      suspendedByEmail: 'admin@example.com',
    });
  });

  it('a never-suspended restaurant has no suspension data', async () => {
    const { queries } = createQueries([restaurant({})]);

    expect(await queries.detail(PENDING_ID)).toMatchObject({
      suspensionReason: null,
      suspendedAt: null,
      suspendedByEmail: null,
    });
  });

  it('lists one page of one status, with skip and take from page and pageSize', async () => {
    const { queries, restaurants } = createQueries([restaurant({})], 41);

    const page = await queries.list({
      status: 'pending',
      page: 3,
      pageSize: 20,
    });

    expect(restaurants.findAndCount).toHaveBeenCalledWith({
      where: { approvalStatus: 'pending' },
      order: adminListOrder('pending'),
      skip: 40,
      take: 20,
    });
    expect(page).toEqual({
      items: [
        {
          id: PENDING_ID,
          name: 'La Esquina de Ana',
          category: 'colombian',
          address: 'Calle 72 # 10-34, Bogotá',
          contactPhone: '+573001234567',
          approvalStatus: 'pending',
          submittedAt: '2026-11-14T15:00:00.000Z',
          reviewedAt: null,
          ownerEmail: `duena-${PENDING_ID.slice(0, 4)}@example.com`,
        },
      ],
      total: 41,
      page: 3,
      pageSize: 20,
    });
  });

  it('reads every owner email of the page in one call', async () => {
    const { queries, users } = createQueries([
      restaurant({}),
      restaurant({ id: REJECTED_ID }),
    ]);

    await queries.list({ status: 'pending', page: 1, pageSize: 20 });

    expect(users.findRestaurantOwnerEmails).toHaveBeenCalledExactlyOnceWith([
      PENDING_ID,
      REJECTED_ID,
    ]);
  });

  it('an empty page has no items and still the total', async () => {
    const { queries } = createQueries([], 3);

    expect(
      await queries.list({ status: 'rejected', page: 9, pageSize: 20 }),
    ).toEqual({ items: [], total: 3, page: 9, pageSize: 20 });
  });

  it('the detail of a rejected restaurant has the reason, the reviewer and the schedules in order', async () => {
    const { queries } = createQueries([
      restaurant({
        id: REJECTED_ID,
        approvalStatus: 'rejected',
        rejectionReason: 'La dirección no coincide con el local.',
        reviewedBy: ADMIN_ID,
        reviewedAt: new Date('2026-11-15T14:30:00Z'),
      }),
    ]);

    const detail = await queries.detail(REJECTED_ID);

    expect(detail).toMatchObject({
      id: REJECTED_ID,
      approvalStatus: 'rejected',
      rejectionReason: 'La dirección no coincide con el local.',
      reviewedAt: '2026-11-15T14:30:00.000Z',
      reviewedByEmail: 'admin@example.com',
      ownerEmail: `duena-${REJECTED_ID.slice(0, 4)}@example.com`,
      latitude: 4.655671,
      longitude: -74.057006,
      createdAt: '2026-11-14T15:00:00.000Z',
    });
    expect(detail.schedules.map((day) => day.dayOfWeek)).toEqual([1, 6]);
    expect(detail.schedules[0]).toEqual({
      dayOfWeek: 1,
      isOpen24h: false,
      opensAt: '09:00',
      closesAt: '22:00',
    });
  });

  it('a pending restaurant has neither reason nor reviewer', async () => {
    const { queries, users } = createQueries([restaurant({})]);

    const detail = await queries.detail(PENDING_ID);

    expect(detail.rejectionReason).toBeNull();
    expect(detail.reviewedByEmail).toBeNull();
    expect(users.findPlatformAdminEmailsByIds).toHaveBeenCalledWith([]);
  });

  it('an approved restaurant does not show a stale reason', async () => {
    const { queries } = createQueries([
      restaurant({
        approvalStatus: 'approved',
        rejectionReason: 'Motivo viejo.',
      }),
    ]);

    expect((await queries.detail(PENDING_ID)).rejectionReason).toBeNull();
  });

  it('answers 404 RESTAURANT_NOT_FOUND for an unknown id', async () => {
    const { queries } = createQueries([]);

    const error = await queries.detail(PENDING_ID).catch((caught) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: RESTAURANT_NOT_FOUND_CODE,
    });
  });
});
