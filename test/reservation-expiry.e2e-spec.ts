import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './../src/app.module.js';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import {
  ReservationExpiryModule,
  ReservationsCheckinModule,
} from './../src/modules/reservations-checkin/index.js';
import { ReservationExpirationService } from './../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { ReservationExpiryScheduler } from './../src/modules/reservations-checkin/reservations/reservation-expiry.scheduler.js';
import { Reservation } from './../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { Restaurant } from './../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { RestaurantSchedule } from './../src/modules/restaurant-operations/restaurants/restaurant-schedule.entity.js';
import { TableLog } from './../src/modules/restaurant-operations/table-logs/table-log.entity.js';
import { Table } from './../src/modules/restaurant-operations/tables/table.entity.js';
import { TableArea } from './../src/modules/restaurant-operations/table-areas/table-area.entity.js';
import { FakeDatabaseModule } from './support/fake-database.js';
import { fakeFirebaseAuth } from './support/test-accounts.js';

// Cuándo corre el proceso de vencimiento: solo lo carga ReservationExpiryModule,
// que importa únicamente AppModule. Así ninguna e2e que monte los módulos aislados
// lo dispara, y nada cambia solo durante una prueba.

const expireAllDue = vi.fn<() => Promise<number>>();

function compose(
  env: Record<string, string>,
  ...modules: unknown[]
): TestingModuleBuilder {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            DEV_USER_ENABLED: 'false',
            FIREBASE_PROJECT_ID: 'firebase-project-example',
            ...env,
          }),
        ],
      }),
      FakeDatabaseModule.with({}),
      EventEmitterModule.forRoot(),
      ...(modules as never[]),
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
    .overrideProvider(getRepositoryToken(TableArea))
    .useValue({})
    .overrideProvider(getRepositoryToken(Reservation))
    .useValue({})
    .overrideProvider(getRepositoryToken(CheckIn))
    .useValue({})
    .overrideProvider(ReservationExpirationService)
    .useValue({ expireAllDue });
}

describe('Proceso de vencimiento: composición (e2e)', () => {
  let app: INestApplication | undefined;

  beforeEach(() => {
    expireAllDue.mockReset();
    expireAllDue.mockResolvedValue(0);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const start = async (builder: TestingModuleBuilder) => {
    const module = await builder.compile();
    app = module.createNestApplication();
    await app.init();
    return app;
  };

  it('AppModule importa ReservationExpiryModule; ReservationsCheckinModule no', () => {
    expect(Reflect.getMetadata('imports', AppModule)).toContain(
      ReservationExpiryModule,
    );
    expect(
      Reflect.getMetadata('imports', ReservationsCheckinModule),
    ).not.toContain(ReservationExpiryModule);
    expect(
      Reflect.getMetadata('providers', ReservationsCheckinModule),
    ).not.toContain(ReservationExpiryScheduler);
  });

  it('el módulo aislado (el que montan las pruebas) no tiene scheduler y no barre al arrancar', async () => {
    const started = await start(compose({}, ReservationsCheckinModule));

    expect(() =>
      started.get(ReservationExpiryScheduler, { strict: false }),
    ).toThrow();
    expect(expireAllDue).not.toHaveBeenCalled();
  });

  it('con RESERVATION_EXPIRY_ENABLED=false, el arranque no vence nada', async () => {
    await start(
      compose({ RESERVATION_EXPIRY_ENABLED: 'false' }, ReservationExpiryModule),
    );

    expect(expireAllDue).not.toHaveBeenCalled();
  });

  it('activo (también sin definir la variable): el arranque hace el barrido inicial, y app.close() lo espera', async () => {
    let finished = false;
    expireAllDue.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return 0;
    });
    const started = await start(compose({}, ReservationExpiryModule));

    expect(expireAllDue).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);

    await started.close();
    app = undefined;
    expect(finished).toBe(true);
  });

  it('un valor inválido impide arrancar, con el mensaje en español', async () => {
    await expect(
      compose(
        { RESERVATION_EXPIRY_ENABLED: 'quizas' },
        ReservationExpiryModule,
      ).compile(),
    ).rejects.toThrow(/RESERVATION_EXPIRY_ENABLED debe ser true o false/);
  });
});
