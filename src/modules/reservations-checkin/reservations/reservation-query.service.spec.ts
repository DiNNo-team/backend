import type { DataSource } from 'typeorm';
import type { CurrentUserData } from '../../identity-access/index.js';
import type { Clock } from '../../search-availability/index.js';
import type { ReservationExpirationService } from './reservation-expiration.service.js';
import { RESERVATION_NOT_FOUND_MESSAGE } from './reservation-errors.js';
import { ReservationQueryService } from './reservation-query.service.js';
import type { Reservation } from './reservation.entity.js';
import type { ReservationViewReader } from './reservation-view.reader.js';

const DINER_ID = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const OTHER_DINER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const RESERVATION_ID = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

const user: CurrentUserData = {
  userId: DINER_ID,
  restaurantId: null,
  role: 'diner' as CurrentUserData['role'],
  restaurantApproval: null,
};

const reservation = (overrides: Partial<Reservation> = {}): Reservation =>
  ({
    id: RESERVATION_ID,
    dinerId: DINER_ID,
    status: 'active',
    expiresAt: new Date('2026-11-05T17:10:00Z'),
    ...overrides,
  }) as Reservation;

// Doble del vencimiento: vence en memoria las reservas debidas (expiresAt <=
// ahora) del almacén, como haría el UPDATE real.
function setup(stored: Reservation[]) {
  const log: string[] = [];
  const dueNow = (row: Reservation) =>
    row.status === 'active' && row.expiresAt.getTime() <= NOW.getTime();
  const expire = (row: Reservation) => {
    row.status = 'expired';
    row.expiredAt = NOW;
  };

  const repository = {
    findOne: vi.fn(({ where }: { where: Partial<Reservation> }) => {
      log.push('read');
      return Promise.resolve(
        stored.find((row) =>
          Object.entries(where).every(
            ([key, value]) => row[key as keyof Reservation] === value,
          ),
        ) ?? null,
      );
    }),
  };
  const expiration = {
    expireIfDue: vi.fn((id: string) => {
      log.push('expireIfDue');
      stored.filter((row) => row.id === id && dueNow(row)).forEach(expire);
      return Promise.resolve(0);
    }),
    expireDueForDiner: vi.fn((dinerId: string) => {
      log.push('expireDueForDiner');
      stored
        .filter((row) => row.dinerId === dinerId && dueNow(row))
        .forEach(expire);
      return Promise.resolve(0);
    }),
  };
  const view = {
    toResponse: vi.fn((row: Reservation, serverTime: Date) =>
      Promise.resolve({
        id: row.id,
        status: row.status,
        serverTime: serverTime.toISOString(),
      }),
    ),
  };
  const dataSource = { getRepository: vi.fn(() => repository) };
  const service = new ReservationQueryService(
    dataSource as unknown as DataSource,
    expiration as unknown as ReservationExpirationService,
    view as unknown as ReservationViewReader,
    { now: () => NOW } as Clock,
  );
  return { service, repository, expiration, view, log };
}

const errorOf = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

describe('ReservationQueryService.findActive', () => {
  it('sin reserva activa devuelve reservation null y el serverTime (200, nunca 404)', async () => {
    const { service } = setup([]);

    await expect(service.findActive(user)).resolves.toEqual({
      reservation: null,
      serverTime: NOW.toISOString(),
    });
  });

  it('con una reserva activa vigente la devuelve, con el mismo serverTime dentro y fuera', async () => {
    const { service, view } = setup([reservation()]);

    const result = await service.findActive(user);

    expect(result.reservation).toEqual({
      id: RESERVATION_ID,
      status: 'active',
      serverTime: NOW.toISOString(),
    });
    expect(result.serverTime).toBe(NOW.toISOString());
    expect(view.toResponse).toHaveBeenCalledWith(expect.anything(), NOW);
  });

  it('aplica el vencimiento al leer ANTES de buscar: una vencida no se devuelve como activa', async () => {
    const { service, expiration, log } = setup([
      reservation({ expiresAt: new Date('2026-11-05T16:59:00Z') }),
    ]);

    const result = await service.findActive(user);

    expect(expiration.expireDueForDiner).toHaveBeenCalledWith(DINER_ID);
    expect(log).toEqual(['expireDueForDiner', 'read']);
    expect(result).toEqual({
      reservation: null,
      serverTime: NOW.toISOString(),
    });
  });

  it('el vencimiento es exclusivo del cierre: expires_at igual a ahora ya está vencida', async () => {
    const { service } = setup([reservation({ expiresAt: NOW })]);

    expect((await service.findActive(user)).reservation).toBeNull();
  });

  it('no devuelve la reserva activa de otro comensal', async () => {
    const { service } = setup([reservation({ dinerId: OTHER_DINER_ID })]);

    expect((await service.findActive(user)).reservation).toBeNull();
  });

  it('busca solo reservas activas del comensal de la sesión', async () => {
    const { service, repository } = setup([]);

    await service.findActive(user);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { dinerId: DINER_ID, status: 'active' },
    });
  });
});

describe('ReservationQueryService.findOne', () => {
  it.each(['cancelled', 'expired', 'completed'] as const)(
    'devuelve la reserva %s tal cual, sin intentar vencerla',
    async (status) => {
      const { service, expiration } = setup([
        reservation({ status, expiresAt: new Date('2026-11-05T16:00:00Z') }),
      ]);

      const result = await service.findOne(user, RESERVATION_ID);

      expect(result).toMatchObject({ id: RESERVATION_ID, status });
      expect(expiration.expireIfDue).not.toHaveBeenCalled();
    },
  );

  it('una activa vigente se devuelve como activa', async () => {
    const { service } = setup([reservation()]);

    await expect(service.findOne(user, RESERVATION_ID)).resolves.toMatchObject({
      status: 'active',
    });
  });

  it('una activa que ya pasó su expires_at se vence al leer y se devuelve como expired', async () => {
    const { service, expiration, log } = setup([
      reservation({ expiresAt: new Date('2026-11-05T16:59:00Z') }),
    ]);

    const result = await service.findOne(user, RESERVATION_ID);

    expect(expiration.expireIfDue).toHaveBeenCalledWith(RESERVATION_ID);
    // Se vuelve a leer después de vencer.
    expect(log).toEqual(['read', 'expireIfDue', 'read']);
    expect(result).toMatchObject({ id: RESERVATION_ID, status: 'expired' });
  });

  it('la reserva de otro comensal es 404 RESERVATION_NOT_FOUND', async () => {
    const { service, repository } = setup([
      reservation({ dinerId: OTHER_DINER_ID }),
    ]);

    const error = await errorOf(service.findOne(user, RESERVATION_ID));

    expect(error).toMatchObject({
      status: 404,
      response: {
        errorCode: 'RESERVATION_NOT_FOUND',
        message: RESERVATION_NOT_FOUND_MESSAGE,
      },
    });
    // El comensal de la sesión va en el filtro de la consulta.
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID, dinerId: DINER_ID },
    });
  });

  it('un id que no existe da el mismo 404 y el mismo mensaje: no se revela que existe', async () => {
    const stored = [reservation({ dinerId: OTHER_DINER_ID })];
    const { service } = setup(stored);

    const ofOther = await errorOf(service.findOne(user, RESERVATION_ID));
    const unknown = await errorOf(service.findOne(user, UNKNOWN_ID));

    expect((unknown as Error).message).toBe(RESERVATION_NOT_FOUND_MESSAGE);
    expect((ofOther as Error).message).toBe((unknown as Error).message);
    expect(unknown).toMatchObject({
      response: { errorCode: 'RESERVATION_NOT_FOUND' },
    });
  });

  it('no intenta vencer la reserva de otro comensal', async () => {
    const { service, expiration } = setup([
      reservation({
        dinerId: OTHER_DINER_ID,
        expiresAt: new Date('2026-11-05T16:00:00Z'),
      }),
    ]);

    await errorOf(service.findOne(user, RESERVATION_ID));

    expect(expiration.expireIfDue).not.toHaveBeenCalled();
  });
});
