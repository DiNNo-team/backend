import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './../src/app.module.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { ReservationsCheckinModule } from './../src/modules/reservations-checkin/index.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { ReservationsForTables } from './../src/modules/reservations-checkin/reservations/reservations-for-tables.js';
import {
  RequireTableReservationsPort,
  TableReservations,
  TableReservationsAccess,
} from './../src/modules/restaurant-operations/index.js';
import { RestaurantOperationsModule } from './../src/modules/restaurant-operations/restaurant-operations.module.js';
import { RESERVATIONS_PORT_MISSING_MESSAGE } from './../src/modules/restaurant-operations/shared/table-reservations.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { FakeDatabaseModule } from './support/fake-database.js';
import { fakeFirebaseAuth } from './support/test-accounts.js';

// Composición real de las mesas con las reservas, con los repositorios en
// memoria. Fija que el puerto TableReservations que declara restaurant-operations
// lo registra reservations-checkin, y que la aplicación NO arranca sin él (en
// los e2e que montan RestaurantOperationsModule solo se usa la implementación nula).

function baseModule(...modules: unknown[]): TestingModuleBuilder {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            DEV_USER_ENABLED: 'false',
            FIREBASE_PROJECT_ID: 'firebase-project-example',
          }),
        ],
      }),
      FakeDatabaseModule.with({}),
      EventEmitterModule.forRoot(),
      ...(modules as never[]),
    ],
    // Lo mismo que AppModule registra en la composición real.
    providers: [RequireTableReservationsPort],
  })
    .overrideProvider(FIREBASE_AUTH)
    .useValue(() => fakeFirebaseAuth)
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
    .overrideProvider(getRepositoryToken(Reservation))
    .useValue({})
    .overrideProvider(getRepositoryToken(CheckIn))
    .useValue({});
}

describe('Reservas de las mesas: composición real (e2e)', () => {
  describe('con ReservationsCheckinModule', () => {
    let app: INestApplication;

    beforeEach(async () => {
      const module = await baseModule(
        RestaurantOperationsModule,
        ReservationsCheckinModule,
      ).compile();
      app = module.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app.close();
    });

    it('TableReservationsAccess resuelve la implementación de reservations-checkin, no la nula', () => {
      const access = app.get(TableReservationsAccess);

      expect(access.isRegistered()).toBe(true);
      expect(app.get(TableReservations, { strict: false })).toBeInstanceOf(
        ReservationsForTables,
      );
    });

    it('las llamadas de las mesas llegan a esa implementación', async () => {
      const port = app.get(TableReservations, { strict: false });
      const count = vi.spyOn(port, 'countActive').mockResolvedValue(7);
      const access = app.get(TableReservationsAccess);

      await expect(access.countActive('restaurante')).resolves.toBe(7);
      expect(count).toHaveBeenCalledWith('restaurante');
    });

    it('la aplicación arranca (RequireTableReservationsPort no lanza)', () => {
      expect(app.get(RequireTableReservationsPort)).toBeDefined();
    });
  });

  describe('sin ReservationsCheckinModule', () => {
    it('el arranque falla con el mensaje en español: no se usa la implementación nula', async () => {
      const module = await baseModule(RestaurantOperationsModule).compile();
      const app = module.createNestApplication();

      await expect(app.init()).rejects.toThrow(
        RESERVATIONS_PORT_MISSING_MESSAGE,
      );
      expect(RESERVATIONS_PORT_MISSING_MESSAGE).toContain(
        'ReservationsCheckinModule',
      );
    });

    it('sin el chequeo, el módulo aislado sí arranca con la implementación nula (lo que usan los otros e2e)', async () => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                DEV_USER_ENABLED: 'false',
                FIREBASE_PROJECT_ID: 'firebase-project-example',
              }),
            ],
          }),
          FakeDatabaseModule.with({}),
          EventEmitterModule.forRoot(),
          RestaurantOperationsModule,
        ],
      })
        .overrideProvider(FIREBASE_AUTH)
        .useValue(() => fakeFirebaseAuth)
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
      const app = module.createNestApplication();

      await app.init();
      expect(module.get(TableReservationsAccess).isRegistered()).toBe(false);
      await app.close();
    });
  });

  describe('AppModule', () => {
    it('registra RequireTableReservationsPort y ReservationsCheckinModule: la composición real exige el puerto', () => {
      const providers = Reflect.getMetadata(
        'providers',
        AppModule,
      ) as unknown[];
      const imports = Reflect.getMetadata('imports', AppModule) as unknown[];

      expect(providers).toContain(RequireTableReservationsPort);
      expect(imports).toContain(ReservationsCheckinModule);
      expect(imports).toContain(RestaurantOperationsModule);
    });
  });
});
