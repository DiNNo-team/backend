import { NotFoundException } from '@nestjs/common';
import type { AvailabilityService } from '../availability/availability.service.js';
import type { AvailabilityResult } from '../availability/availability.types.js';
import type {
  PublicRestaurantProfile,
  PublicRestaurantReader,
} from './public-restaurant.reader.js';
import { PublicRestaurantService } from './public-restaurant.service.js';

const ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const CASA_72 = { latitude: 4.655671, longitude: -74.057006 };
// km per degree of latitude on the sphere of haversineKm.
const KM_PER_DEGREE = (6371.0088 * Math.PI) / 180;

const SCHEDULES = [
  { dayOfWeek: 1, isOpen24h: false, opensAt: '11:00', closesAt: '23:00' },
  { dayOfWeek: 5, isOpen24h: false, opensAt: '11:00', closesAt: '02:00' },
  { dayOfWeek: 6, isOpen24h: true, opensAt: null, closesAt: null },
];

const PROFILE: PublicRestaurantProfile = {
  id: ID,
  name: 'Casa 72',
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  location: CASA_72,
  schedules: SCHEDULES,
};

const OPEN_FEW: AvailabilityResult = {
  isOpenNow: true,
  availability: 'few',
  isSearchable: true,
};

function setup(
  profile: PublicRestaurantProfile | null,
  availability: AvailabilityResult | null = OPEN_FEW,
) {
  const reader = { findProfile: vi.fn().mockResolvedValue(profile) };
  const availabilityService = {
    getForRestaurant: vi.fn().mockResolvedValue(availability),
  };
  const service = new PublicRestaurantService(
    reader as unknown as PublicRestaurantReader,
    availabilityService as unknown as AvailabilityService,
  );
  return { service, reader, availabilityService };
}

async function expectNotFound(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(NotFoundException);
  expect((error as NotFoundException).getResponse()).toEqual({
    statusCode: 404,
    message: 'Este restaurante ya no está disponible.',
    error: 'Not Found',
    errorCode: 'RESTAURANT_NOT_FOUND',
  });
}

describe('PublicRestaurantService', () => {
  it('answers the contract keys exactly, without distanceKm nor counts', async () => {
    const { service, reader, availabilityService } = setup(PROFILE);

    const result = await service.getById(ID);

    expect(result).toStrictEqual({
      id: ID,
      name: 'Casa 72',
      category: 'colombian',
      address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
      latitude: 4.655671,
      longitude: -74.057006,
      schedules: SCHEDULES,
      isOpenNow: true,
      availability: 'few',
    });
    expect(result).not.toHaveProperty('distanceKm');
    expect(result).not.toHaveProperty('isSearchable');
    expect(reader.findProfile).toHaveBeenCalledWith(ID);
    expect(availabilityService.getForRestaurant).toHaveBeenCalledTimes(1);
    expect(availabilityService.getForRestaurant).toHaveBeenCalledWith(ID);
  });

  it('adds distanceKm with 2 decimals when the location arrives', async () => {
    const { service } = setup(PROFILE);
    const origin = {
      latitude: CASA_72.latitude - 0.654321 / KM_PER_DEGREE,
      longitude: CASA_72.longitude,
    };

    const result = await service.getById(ID, origin);

    expect(result.distanceKm).toBe(0.65);
  });

  it('answers distanceKm 0 from the restaurant itself', async () => {
    const { service } = setup(PROFILE);

    await expect(service.getById(ID, CASA_72)).resolves.toHaveProperty(
      'distanceKm',
      0,
    );
  });

  it.each<[string, AvailabilityResult]>([
    [
      'closed by schedule',
      { isOpenNow: false, availability: 'closed', isSearchable: false },
    ],
    [
      'switched to Cerrado (is_open = false)',
      { isOpenNow: false, availability: 'closed', isSearchable: false },
    ],
  ])('answers 200 when %s: isOpenNow false, closed', async (_case, closed) => {
    const { service } = setup(PROFILE, closed);

    const result = await service.getById(ID);

    expect(result.isOpenNow).toBe(false);
    expect(result.availability).toBe('closed');
  });

  it.each(['available', 'none'] as const)(
    'keeps the level %s',
    async (level) => {
      const { service } = setup(PROFILE, {
        isOpenNow: true,
        availability: level,
        isSearchable: level !== 'none',
      });

      await expect(service.getById(ID)).resolves.toHaveProperty(
        'availability',
        level,
      );
    },
  );

  it('404 RESTAURANT_NOT_FOUND for an unknown restaurant', async () => {
    const { service } = setup(null, null);

    await expectNotFound(service.getById(ID));
  });

  it('404 RESTAURANT_NOT_FOUND for a restaurant without coordinates', async () => {
    const { service } = setup({ ...PROFILE, location: null });

    await expectNotFound(service.getById(ID, CASA_72));
  });

  it('404 RESTAURANT_NOT_FOUND when the availability does not know it', async () => {
    const { service } = setup(PROFILE, null);

    await expectNotFound(service.getById(ID));
  });
});
