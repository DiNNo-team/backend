import type { DataSource } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import type { Clock } from '../../search-availability/index.js';
import type { ReservationExpirationService } from '../reservations/reservation-expiration.service.js';
import { Reservation } from '../reservations/reservation.entity.js';
import type {
  LabelledReservation,
  ReservationLabelsReader,
} from './reservation-labels.reader.js';
import { RestaurantReservationsService } from './restaurant-reservations.service.js';

const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

const admin: CurrentUserData = {
  userId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  restaurantId: RESTAURANT_ID,
  role: 'restaurant_admin' as CurrentUserData['role'],
};

const row = (id: string, tableId: string, dinerId: string) => ({
  id,
  status: 'active',
  partySize: 2,
  dinerId,
  tableId,
  createdAt: new Date('2026-11-05T16:50:00Z'),
  expiresAt: new Date('2026-11-05T17:05:00Z'),
});

function setup(rows: ReturnType<typeof row>[] = []) {
  const log: string[] = [];
  const reservationsRepo = {
    find: vi.fn(() => {
      log.push('find');
      return Promise.resolve(rows);
    }),
  };
  const dataSource = { getRepository: vi.fn(() => reservationsRepo) };
  const expiration = {
    expireDueForRestaurant: vi.fn(() => {
      log.push('expire');
      return Promise.resolve(0);
    }),
  };
  const labels = {
    read: vi.fn(() =>
      Promise.resolve((reservation: LabelledReservation) => ({
        tableIdentifier: `mesa-${reservation.tableId}`,
        dinerName: reservation.dinerId === 'sin-nombre' ? null : 'Ana',
      })),
    ),
  };
  const service = new RestaurantReservationsService(
    dataSource as unknown as DataSource,
    expiration as unknown as ReservationExpirationService,
    labels as unknown as ReservationLabelsReader,
    { now: () => NOW } as Clock,
  );
  return { service, log, dataSource, reservationsRepo, expiration, labels };
}

describe('RestaurantReservationsService', () => {
  it('vence las debidas del restaurante ANTES de leer', async () => {
    const t = setup();

    await t.service.list(admin);

    expect(t.expiration.expireDueForRestaurant).toHaveBeenCalledWith(
      RESTAURANT_ID,
    );
    expect(t.log).toEqual(['expire', 'find']);
  });

  it('por defecto pide las activas del restaurante de la sesión, de la más próxima a vencer a la más lejana', async () => {
    const t = setup();

    await t.service.list(admin);

    expect(t.dataSource.getRepository).toHaveBeenCalledWith(Reservation);
    expect(t.reservationsRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: RESTAURANT_ID, status: 'active' },
        order: { expiresAt: 'ASC', id: 'ASC' },
      }),
    );
  });

  it.each(['active', 'cancelled', 'expired', 'completed'] as const)(
    'filtra por el estado %s',
    async (status) => {
      const t = setup();

      await t.service.list(admin, status);

      expect(t.reservationsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { restaurantId: RESTAURANT_ID, status },
        }),
      );
    },
  );

  it('la consulta ni siquiera pide la columna code', async () => {
    const t = setup();

    await t.service.list(admin);

    const [[options]] = t.reservationsRepo.find.mock.calls as unknown as [
      [{ select: Record<string, boolean> }],
    ];
    expect(Object.keys(options.select)).not.toContain('code');
  });

  it('responde la forma de §12.8 en el orden de la base, con el mismo serverTime y sin code aunque la fila lo trajera', async () => {
    const first = {
      ...row('r1', 't1', 'd1'),
      code: 'K7M4QX',
    };
    const t = setup([first, row('r2', 't2', 'sin-nombre')]);

    const list = await t.service.list(admin);

    expect(list).toEqual([
      {
        id: 'r1',
        status: 'active',
        partySize: 2,
        dinerName: 'Ana',
        tableId: 't1',
        tableIdentifier: 'mesa-t1',
        createdAt: '2026-11-05T16:50:00.000Z',
        expiresAt: '2026-11-05T17:05:00.000Z',
        serverTime: NOW.toISOString(),
      },
      {
        id: 'r2',
        status: 'active',
        partySize: 2,
        dinerName: null,
        tableId: 't2',
        tableIdentifier: 'mesa-t2',
        createdAt: '2026-11-05T16:50:00.000Z',
        expiresAt: '2026-11-05T17:05:00.000Z',
        serverTime: NOW.toISOString(),
      },
    ]);
    expect(JSON.stringify(list)).not.toContain('K7M4QX');
    expect(JSON.stringify(list)).not.toContain('"code"');
  });

  it('sin reservas responde [] sin más consultas', async () => {
    const t = setup();

    await expect(t.service.list(admin)).resolves.toEqual([]);
    expect(t.labels.read).not.toHaveBeenCalled();
  });

  it('un admin sin restaurante recibe RESTAURANT_REQUIRED, sin vencer nada', async () => {
    const t = setup();

    await expect(
      t.service.list({ ...admin, restaurantId: null }),
    ).rejects.toMatchObject({
      status: 403,
      response: { errorCode: 'RESTAURANT_REQUIRED' },
    });
    expect(t.expiration.expireDueForRestaurant).not.toHaveBeenCalled();
  });
});
