import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { DbTableStatusLog } from './../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableStatusLog } from './../src/modules/restaurant-operations/tables/table-status-log.js';

// Mounts the module like the other e2e tests, without PostgreSQL, but keeps
// the real TableStatusLog provider to check which class the module wires.
describe('TableStatusLog wiring (e2e)', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DEV_USER_ENABLED: 'true',
              DEV_USER_ID: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
              FIREBASE_PROJECT_ID: 'firebase-project-example',
            }),
          ],
        }),
        RestaurantOperationsModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(getRepositoryToken(Restaurant))
      .useValue({})
      .overrideProvider(getRepositoryToken(RestaurantSchedule))
      .useValue({})
      .overrideProvider(getRepositoryToken(Table))
      .useValue({})
      .overrideProvider(getRepositoryToken(TableLog))
      .useValue({})
      .compile();
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('resolves TableStatusLog to the real DbTableStatusLog', () => {
    expect(moduleRef.get(TableStatusLog)).toBeInstanceOf(DbTableStatusLog);
  });
});
