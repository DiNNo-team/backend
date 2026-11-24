import { createPseudonymizer, newSalt } from './pseudonym.js';
import {
  CHECK_INS_HEADER,
  checkInRow,
  RESERVATIONS_HEADER,
  type ReservationSource,
  reservationRow,
  secondsToResolve,
  TABLE_LOGS_HEADER,
  tableLogRow,
} from './rows.js';

const pseudonymize = createPseudonymizer(newSalt());

function reservation(
  overrides: Partial<ReservationSource> = {},
): ReservationSource {
  return {
    id: 'r1',
    dinerId: 'd1',
    restaurantId: 'rest1',
    category: 'colombian',
    tableCapacity: 4,
    partySize: 2,
    status: 'active',
    // 02:30 UTC del viernes = 21:30 del jueves en Bogotá.
    createdAt: new Date('2026-11-06T02:30:00Z'),
    expiresAt: new Date('2026-11-06T02:45:00Z'),
    expiredAt: null,
    cancelledAt: null,
    checkedInAt: null,
    noShow: false,
    ...overrides,
  };
}

describe('reservationRow', () => {
  it('tiene una celda por columna de la cabecera', () => {
    expect(reservationRow(reservation(), pseudonymize)).toHaveLength(
      RESERVATIONS_HEADER.length,
    );
  });

  it('una reserva activa no tiene cierre: celdas vacías y segundos null', () => {
    const row = reservationRow(reservation(), pseudonymize);
    expect(row[9]).toBeNull();
    expect(row[10]).toBeNull();
    expect(row[11]).toBeNull();
    expect(row.at(-1)).toBeNull();
  });

  it('usa el día y la hora de Bogotá, y no incluye el id del comensal', () => {
    const row = reservationRow(reservation(), pseudonymize);
    expect(row[13]).toBe(4);
    expect(row[14]).toBe(21);
    expect(row[1]).toMatch(/^[0-9a-f]{16}$/);
    expect(row).not.toContain('d1');
  });

  it('deja la categoría en null si el restaurante no tiene', () => {
    const row = reservationRow(reservation({ category: null }), pseudonymize);
    expect(row[3]).toBeNull();
  });
});

describe('secondsToResolve', () => {
  it.each([
    [
      'cancelada',
      { status: 'cancelled', cancelledAt: new Date('2026-11-06T02:31:00Z') },
      60,
    ],
    [
      'vencida',
      { status: 'expired', expiredAt: new Date('2026-11-06T02:45:10Z') },
      910,
    ],
    [
      'cumplida',
      { status: 'completed', checkedInAt: new Date('2026-11-06T02:40:00Z') },
      600,
    ],
  ])('%s', (_name, overrides, expected) => {
    expect(secondsToResolve(reservation(overrides))).toBe(expected);
  });

  it('activa: null', () => {
    expect(secondsToResolve(reservation())).toBeNull();
  });
});

describe('checkInRow y tableLogRow', () => {
  it('check-in: día y hora de Bogotá', () => {
    const row = checkInRow({
      id: 'c1',
      reservationId: 'r1',
      restaurantId: 'rest1',
      checkedInAt: new Date('2026-11-06T05:00:00Z'),
    });
    expect(row).toHaveLength(CHECK_INS_HEADER.length);
    expect(row.slice(4)).toEqual([5, 0]);
  });

  it('bitácora: el tipo de actor sale del rol, sin usuario es system', () => {
    const base = {
      id: 'l1',
      restaurantId: 'rest1',
      tableId: 't1',
      previousStatus: 'available',
      newStatus: 'reserved',
      source: 'reservation',
      changedAt: new Date('2026-11-06T02:30:00Z'),
    };
    const manual = tableLogRow({ ...base, actorRole: 'restaurant_admin' });
    const automatic = tableLogRow({ ...base, actorRole: null });
    expect(manual).toHaveLength(TABLE_LOGS_HEADER.length);
    expect(manual.at(-1)).toBe('restaurant_admin');
    expect(automatic.at(-1)).toBe('system');
  });
});
