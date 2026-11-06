import {
  type CurrentTable,
  type InitialTable,
  planTableChanges,
} from './plan.js';

const initial: InitialTable[] = [
  { identifier: 'Mesa 1', capacity: 2, status: 'available', isActive: true },
  { identifier: 'Mesa 2', capacity: 4, status: 'available', isActive: true },
  { identifier: 'Mesa 3', capacity: 8, status: 'available', isActive: false },
];

function current(overrides: Partial<CurrentTable>[]): CurrentTable[] {
  const base: CurrentTable[] = initial.map((table, index) => ({
    ...table,
    id: `id-${index + 1}`,
  }));
  return base.map((table, index) => ({ ...table, ...overrides[index] }));
}

describe('planTableChanges', () => {
  it('mesas ya iguales: nada cambia ni se registra (idempotente)', () => {
    const plan = planTableChanges(current([]), initial);
    expect(plan).toEqual({ changes: [], unchanged: 3, missing: [] });
  });

  it('cambiar el estado registra un paso anterior → inicial', () => {
    const plan = planTableChanges(current([{ status: 'occupied' }]), initial);
    expect(plan.unchanged).toBe(2);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      tableId: 'id-1',
      logSteps: [{ previousStatus: 'occupied', newStatus: 'available' }],
    });
  });

  it('desactivar una mesa que no está available pasa antes por available', () => {
    const plan = planTableChanges(
      current([{}, {}, { status: 'reserved', isActive: true }]),
      initial,
    );
    expect(plan.changes[0].logSteps).toEqual([
      { previousStatus: 'reserved', newStatus: 'available' },
      { previousStatus: 'available', newStatus: 'inactive' },
    ]);
  });

  it('desactivar una mesa available es un solo paso', () => {
    const plan = planTableChanges(
      current([{}, {}, { status: 'available', isActive: true }]),
      initial,
    );
    expect(plan.changes[0].logSteps).toEqual([
      { previousStatus: 'available', newStatus: 'inactive' },
    ]);
  });

  it('reactivar registra inactive → estado inicial', () => {
    const plan = planTableChanges(current([{ isActive: false }]), initial);
    expect(plan.changes[0].logSteps).toEqual([
      { previousStatus: 'inactive', newStatus: 'available' },
    ]);
  });

  it('una mesa inactiva que debe seguir inactiva no genera bitácora, aunque cambie su estado interno', () => {
    const plan = planTableChanges(
      current([{}, {}, { status: 'occupied', isActive: false }]),
      initial,
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].logSteps).toEqual([]);
    expect(plan.changes[0].to.status).toBe('available');
  });

  it('un cambio de capacidad se actualiza pero no se registra', () => {
    const plan = planTableChanges(current([{ capacity: 6 }]), initial);
    expect(plan.changes[0].logSteps).toEqual([]);
    expect(plan.changes[0].to.capacity).toBe(2);
  });

  it('estado y actividad a la vez: un paso por cada cambio', () => {
    const plan = planTableChanges(
      current([{ isActive: false, status: 'occupied' }]),
      initial,
    );
    expect(plan.changes[0].logSteps).toEqual([
      { previousStatus: 'inactive', newStatus: 'available' },
    ]);
  });

  it('empareja por identificador sin mayúsculas ni espacios, y avisa de las que faltan', () => {
    const plan = planTableChanges(
      [
        {
          id: 'x',
          identifier: ' mesa 1 ',
          capacity: 2,
          status: 'available',
          isActive: true,
        },
      ],
      initial,
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.missing).toEqual(['Mesa 2', 'Mesa 3']);
  });

  it('no toca mesas que no están en el estado inicial', () => {
    const extra: CurrentTable = {
      id: 'extra',
      identifier: 'Mesa 99',
      capacity: 2,
      status: 'occupied',
      isActive: true,
    };
    const plan = planTableChanges([...current([]), extra], initial);
    expect(plan.changes).toEqual([]);
  });
});
