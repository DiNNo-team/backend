import type { TableReservationsAccess } from './../../src/modules/restaurant-operations/index.js';

// Doble de TableReservationsAccess para las pruebas unitarias de las mesas:
// por defecto, ninguna mesa tiene reserva y el restaurante tiene 0. Cada prueba
// reemplaza lo que necesite.
export interface FakeTableReservations {
  expireDueForTable: ReturnType<typeof vi.fn>;
  findActiveForTable: ReturnType<typeof vi.fn>;
  countActive: ReturnType<typeof vi.fn>;
}

export function fakeTableReservations(
  overrides: Partial<FakeTableReservations> = {},
): FakeTableReservations & TableReservationsAccess {
  return {
    expireDueForTable: vi.fn().mockResolvedValue(undefined),
    findActiveForTable: vi.fn().mockResolvedValue(null),
    countActive: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as FakeTableReservations & TableReservationsAccess;
}
