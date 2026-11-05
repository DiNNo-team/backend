import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import {
  RESERVATIONS_PORT_MISSING_MESSAGE,
  RequireTableReservationsPort,
  TableReservations,
  TableReservationsAccess,
} from './table-reservations.js';

const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
const manager = {} as EntityManager;

// Implementación de mentira del puerto, como la que registra reservations-checkin.
class FakePort extends TableReservations {
  expireDueForTable = vi.fn(() => Promise.resolve());
  findActiveForTable = vi.fn(() => Promise.resolve({ partySize: 3 }));
  countActive = vi.fn(() => Promise.resolve(5));
}

// Dos módulos separados, como en la aplicación: uno declara el acceso (el de
// restaurant-operations) y otro registra el puerto (el de reservations-checkin).
@Module({
  providers: [TableReservationsAccess],
  exports: [TableReservationsAccess],
})
class AccessModule {}

@Module({ providers: [{ provide: TableReservations, useClass: FakePort }] })
class PortModule {}

describe('TableReservationsAccess', () => {
  it('sin puerto registrado usa la implementación nula: sin reservas y contador 0', async () => {
    const app = await Test.createTestingModule({
      imports: [AccessModule],
    }).compile();
    const access = app.get(TableReservationsAccess);

    expect(access.isRegistered()).toBe(false);
    await expect(access.expireDueForTable(TABLE_ID)).resolves.toBeUndefined();
    await expect(
      access.findActiveForTable(TABLE_ID, manager),
    ).resolves.toBeNull();
    await expect(access.countActive(RESTAURANT_ID)).resolves.toBe(0);
  });

  it('con el puerto registrado en OTRO módulo lo encuentra y delega en él', async () => {
    const app = await Test.createTestingModule({
      imports: [AccessModule, PortModule],
    }).compile();
    const access = app.get(TableReservationsAccess);
    const port = app.get(TableReservations) as FakePort;

    expect(access.isRegistered()).toBe(true);
    await expect(access.countActive(RESTAURANT_ID)).resolves.toBe(5);
    await expect(access.findActiveForTable(TABLE_ID, manager)).resolves.toEqual(
      { partySize: 3 },
    );
    await access.expireDueForTable(TABLE_ID);
    expect(port.countActive).toHaveBeenCalledWith(RESTAURANT_ID);
    expect(port.findActiveForTable).toHaveBeenCalledWith(TABLE_ID, manager);
    expect(port.expireDueForTable).toHaveBeenCalledWith(TABLE_ID);
  });
});

describe('RequireTableReservationsPort', () => {
  const rootWith = (...imports: unknown[]) =>
    Test.createTestingModule({
      imports: imports as never[],
      providers: [RequireTableReservationsPort],
    }).compile();

  it('con el puerto real registrado, la aplicación arranca', async () => {
    const module = await rootWith(AccessModule, PortModule);
    const app = module.createNestApplication();

    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('sin el puerto real, el arranque falla con un mensaje claro en español', async () => {
    const module = await rootWith(AccessModule);
    const app = module.createNestApplication();

    await expect(app.init()).rejects.toThrow(RESERVATIONS_PORT_MISSING_MESSAGE);
    expect(RESERVATIONS_PORT_MISSING_MESSAGE).toMatch(
      /ReservationsCheckinModule.*AppModule/,
    );
  });
});
