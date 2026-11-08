import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FIREBASE_AUTH } from './../src/modules/identity-access/auth/firebase-admin.provider.js';
import { User } from './../src/modules/identity-access/users/user.entity.js';

import {
  ReservationConfig,
  SearchAvailabilityModule,
} from './../src/modules/search-availability/index.js';
import { FakeDatabaseModule } from './support/fake-database.js';

// Composición: SearchAvailabilityModule (dueño de ReservationConfig) valida
// RESERVATION_TTL_MINUTES al crearse. AppModule lo registra, así que un valor
// inválido impide arrancar la app.
async function compile(ttl: string | undefined) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            DEV_USER_ENABLED: 'false',
            FIREBASE_PROJECT_ID: 'firebase-project-example',
            ...(ttl === undefined ? {} : { RESERVATION_TTL_MINUTES: ttl }),
          }),
        ],
      }),
      FakeDatabaseModule.with({}),
      SearchAvailabilityModule,
    ],
  })
    .overrideProvider(FIREBASE_AUTH)
    .useValue(() => ({}))
    .overrideProvider(getRepositoryToken(User))
    .useValue({})
    .compile();
}

describe('RESERVATION_TTL_MINUTES en SearchAvailabilityModule', () => {
  it.each([
    [undefined, 15],
    ['3', 3],
  ])('con %s entrega ttlMinutes %i', async (value, expected) => {
    const module = await compile(value);

    expect(module.get(ReservationConfig)).toEqual({ ttlMinutes: expected });
    await module.close();
  });

  it.each(['abc', '1', '16', ''])(
    'con "%s" el módulo no arranca',
    async (value) => {
      await expect(compile(value)).rejects.toThrow(/RESERVATION_TTL_MINUTES/);
    },
  );
});
