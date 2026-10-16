import { Logger } from '@nestjs/common';
import type { AvailabilityService } from '../availability/availability.service.js';
import { AvailabilityChangedListener } from './availability-changed.listener.js';
import type { AvailabilityGateway } from './availability.gateway.js';

const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';

function createListener(getForRestaurant: ReturnType<typeof vi.fn>) {
  const gateway = { broadcast: vi.fn() };
  const listener = new AvailabilityChangedListener(
    { getForRestaurant } as unknown as AvailabilityService,
    gateway as unknown as AvailabilityGateway,
  );
  return { listener, gateway, getForRestaurant };
}

describe('AvailabilityChangedListener', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recalculates the restaurant and hands the exact contract payload to the gateway', async () => {
    const { listener, gateway, getForRestaurant } = createListener(
      vi.fn().mockResolvedValue({
        isOpenNow: true,
        availability: 'few',
        isSearchable: true,
      }),
    );

    await listener.handle({ restaurantId: RESTAURANT_ID });

    expect(getForRestaurant).toHaveBeenCalledWith(RESTAURANT_ID);
    expect(gateway.broadcast).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      availability: 'few',
      isOpenNow: true,
      isSearchable: true,
    });
  });

  it('sends nothing when the restaurant no longer exists', async () => {
    const { listener, gateway } = createListener(
      vi.fn().mockResolvedValue(null),
    );

    await listener.handle({ restaurantId: RESTAURANT_ID });

    expect(gateway.broadcast).not.toHaveBeenCalled();
  });

  it('never propagates an error: it logs a warning with the restaurant id only', async () => {
    const failure = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), {
      name: 'QueryFailedError',
    });
    const { listener, gateway } = createListener(
      vi.fn().mockRejectedValue(failure),
    );

    await expect(
      listener.handle({ restaurantId: RESTAURANT_ID }),
    ).resolves.toBeUndefined();
    expect(gateway.broadcast).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      `Could not send availability.changed for restaurant ${RESTAURANT_ID}: QueryFailedError`,
    );
  });
});
