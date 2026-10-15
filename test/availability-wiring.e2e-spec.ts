import { Global, Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  AvailabilityService,
  Clock,
  SearchAvailabilityModule,
} from './../src/modules/search-availability/index.js';

// Friday 2026-10-16 13:00 in Bogotá.
const FRIDAY_13H = new Date('2026-10-16T18:00:00Z');

const restaurants = [
  { id: 'casa', isOpen: true, latitude: 4.655671, longitude: -74.057006 },
];
const schedules = [
  {
    restaurantId: 'casa',
    dayOfWeek: 5,
    isOpen24h: false,
    opensAt: '12:00:00',
    closesAt: '22:00:00',
  },
];
const tables = [
  { restaurantId: 'casa', capacity: 4, status: 'available', isActive: true },
];

// In the app, TypeOrmModule.forRoot provides DataSource globally; here a
// stand-in that answers by entity name, without PostgreSQL.
@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        getRepository: (name: string) => ({
          find: () =>
            Promise.resolve(
              { Restaurant: restaurants, RestaurantSchedule: schedules }[
                name
              ] ?? tables,
            ),
        }),
      },
    },
  ],
  exports: [DataSource],
})
class FakeDatabaseModule {}

// A module of another domain that uses the public surface, as the search
// and Sprint 3 will.
@Injectable()
class Consumer {
  constructor(readonly availability: AvailabilityService) {}
}

@Module({
  imports: [SearchAvailabilityModule],
  providers: [Consumer],
})
class ConsumerModule {}

describe('SearchAvailabilityModule wiring (e2e)', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [FakeDatabaseModule, ConsumerModule],
    })
      .overrideProvider(Clock)
      .useValue({ now: () => FRIDAY_13H })
      .compile();
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('exports AvailabilityService to the modules that import it', () => {
    expect(moduleRef.get(Consumer).availability).toBeInstanceOf(
      AvailabilityService,
    );
  });

  it('lets the tests fix the time by overriding Clock', async () => {
    await expect(
      moduleRef.get(Consumer).availability.getForRestaurant('casa'),
    ).resolves.toEqual({
      isOpenNow: true,
      availability: 'available',
      isSearchable: true,
    });
  });
});
