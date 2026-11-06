import { MoreThan, type DataSource, type EntityManager } from 'typeorm';
import type { Clock } from '../../search-availability/index.js';
import type { ReservationExpirationService } from './reservation-expiration.service.js';
import { Reservation } from './reservation.entity.js';
import { ReservationsForTables } from './reservations-for-tables.js';

const TABLE_ID = '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f';
const RESTAURANT_ID = '9c8b7a6f-5e4d-4c3b-a2a1-0f9e8d7c6b5a';
// 2026-11-05 12:00 en Bogotá.
const NOW = new Date('2026-11-05T17:00:00Z');

function setup(found: { partySize: number } | null = null, count = 0) {
  const repository = {
    findOne: vi.fn(() => Promise.resolve(found)),
    count: vi.fn(() => Promise.resolve(count)),
  };
  const manager = {
    getRepository: vi.fn(() => repository),
  } as unknown as EntityManager;
  const dataSource = { getRepository: vi.fn(() => repository) };
  const expiration = { expireDueForTable: vi.fn(() => Promise.resolve(1)) };
  const adapter = new ReservationsForTables(
    dataSource as unknown as DataSource,
    expiration as unknown as ReservationExpirationService,
    { now: () => NOW } as Clock,
  );
  return { adapter, repository, manager, dataSource, expiration };
}

describe('ReservationsForTables', () => {
  it('expireDueForTable delega en el servicio de vencimiento con el alcance de la mesa', async () => {
    const t = setup();

    await t.adapter.expireDueForTable(TABLE_ID);

    expect(t.expiration.expireDueForTable).toHaveBeenCalledWith(TABLE_ID);
  });

  it('findActiveForTable usa el manager de la transacción y busca activas con expires_at > ahora', async () => {
    const t = setup({ partySize: 4 });

    const result = await t.adapter.findActiveForTable(TABLE_ID, t.manager);

    expect(result).toEqual({ partySize: 4 });
    expect(t.manager.getRepository).toHaveBeenCalledWith(Reservation);
    expect(t.dataSource.getRepository).not.toHaveBeenCalled();
    expect(t.repository.findOne).toHaveBeenCalledWith({
      where: {
        tableId: TABLE_ID,
        status: 'active',
        expiresAt: MoreThan(NOW),
      },
      select: { partySize: true },
    });
  });

  it('findActiveForTable devuelve null si no hay reserva activa vigente', async () => {
    const t = setup(null);

    await expect(
      t.adapter.findActiveForTable(TABLE_ID, t.manager),
    ).resolves.toBeNull();
  });

  it('countActive cuenta las activas del restaurante con expires_at > ahora (ignora las demás por estado)', async () => {
    const t = setup(null, 3);

    const result = await t.adapter.countActive(RESTAURANT_ID);

    expect(result).toBe(3);
    expect(t.repository.count).toHaveBeenCalledWith({
      where: {
        restaurantId: RESTAURANT_ID,
        status: 'active',
        expiresAt: MoreThan(NOW),
      },
    });
  });

  it('countActive filtra por el restaurante recibido: las de otro restaurante no cuentan', async () => {
    const t = setup(null, 0);

    await t.adapter.countActive('otro-restaurante');

    expect(t.repository.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ restaurantId: 'otro-restaurante' }),
    });
  });
});
