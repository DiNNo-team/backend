import type { TableLogStatus } from '../../modules/restaurant-operations/tables/table-status-log.js';

// Cálculo puro de qué mesas cambia demo:reset y qué escribe en la bitácora.
// Sin base de datos: se prueba con datos en memoria.

export type TableStatus = 'available' | 'reserved' | 'occupied';

export interface TableState {
  capacity: number;
  status: TableStatus;
  isActive: boolean;
}

export interface InitialTable extends TableState {
  identifier: string;
}

export interface CurrentTable extends TableState {
  id: string;
  identifier: string;
}

export interface LogStep {
  previousStatus: TableLogStatus;
  newStatus: TableLogStatus;
}

export interface TableChange {
  tableId: string;
  identifier: string;
  from: TableState;
  to: TableState;
  // Una fila de bitácora (source 'system', sin usuario) por paso, en orden.
  logSteps: LogStep[];
}

export interface TablePlan {
  changes: TableChange[];
  unchanged: number;
  // Identificadores del estado inicial que no existen en el restaurante: el
  // script no crea mesas.
  missing: string[];
}

// Igual que el índice único de la base: sin mayúsculas ni espacios de más.
const normalize = (identifier: string): string =>
  identifier.trim().toLowerCase();

// El estado que ve la bitácora: una mesa desactivada es 'inactive'.
const logStatus = (state: TableState): TableLogStatus =>
  state.isActive ? state.status : 'inactive';

// Pasos de bitácora para ir de `from` a `to`, con el mismo criterio de
// desactivar y reactivar de las mesas:
// - Desactivar solo una mesa 'available' (§12.2): si estaba en otro estado,
//   primero pasa a 'available' y luego a 'inactive'.
// - Reactivar registra 'inactive' → el estado inicial.
// - Una mesa que ya está inactiva y debe seguir inactiva no genera pasos.
// - Capacidad y estado interno de una mesa inactiva no se registran.
function logStepsBetween(from: TableState, to: TableState): LogStep[] {
  const steps: LogStep[] = [];
  let current = logStatus(from);
  const moveTo = (next: TableLogStatus): void => {
    steps.push({ previousStatus: current, newStatus: next });
    current = next;
  };

  if (!to.isActive) {
    if (from.isActive) {
      if (from.status !== 'available') {
        moveTo('available');
      }
      moveTo('inactive');
    }
  } else if (current !== to.status) {
    moveTo(to.status);
  }
  return steps;
}

function differs(from: TableState, to: TableState): boolean {
  return (
    from.capacity !== to.capacity ||
    from.status !== to.status ||
    from.isActive !== to.isActive
  );
}

export function planTableChanges(
  current: readonly CurrentTable[],
  initial: readonly InitialTable[],
): TablePlan {
  const byIdentifier = new Map(
    current.map((table) => [normalize(table.identifier), table]),
  );
  const plan: TablePlan = { changes: [], unchanged: 0, missing: [] };

  for (const target of initial) {
    const table = byIdentifier.get(normalize(target.identifier));
    if (!table) {
      plan.missing.push(target.identifier);
      continue;
    }
    const from: TableState = {
      capacity: table.capacity,
      status: table.status,
      isActive: table.isActive,
    };
    const to: TableState = {
      capacity: target.capacity,
      status: target.status,
      isActive: target.isActive,
    };
    if (!differs(from, to)) {
      plan.unchanged += 1;
      continue;
    }
    plan.changes.push({
      tableId: table.id,
      identifier: table.identifier,
      from,
      to,
      logSteps: logStepsBetween(from, to),
    });
  }
  return plan;
}
