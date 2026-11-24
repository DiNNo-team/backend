import type { EntityManager } from 'typeorm';
import type { AfterCommitEvents } from '../../../common/events/after-commit-events.js';
import {
  recordTableChange,
  type TableStatusLog,
} from '../../restaurant-operations/index.js';

// La mesa se lee y escribe por nombre de entidad (es de restaurant-operations).
interface TableRow {
  id: string;
  status: string;
}

// Quién libera la mesa y por qué (§12.3): el vencimiento es automático (sin
// usuario, source 'system'); la cancelación es del comensal (source 'reservation').
export interface TableRelease {
  restaurantId: string;
  tableId: string;
  userId: string | null;
  source: 'reservation' | 'system';
  changedAt: Date;
}

// A dónde pasa la mesa de una reserva que termina (§12.3): vuelve a Disponible
// (vencer, cancelar) o queda Ocupada (check-in).
export interface ReservedTableMove extends TableRelease {
  to: 'available' | 'occupied';
}

// LA regla de "mover la mesa de una reserva que termina": sale de reserved SOLO
// si sigue reserved (el UPDATE lleva la condición). Nunca se pisa un estado que
// el restaurante cambió después. La bitácora se escribe solo si la mesa realmente
// cambió. Devuelve true si cambió.
//
// No abre transacciones ni publica eventos: actúa con el manager recibido y deja
// table.status_changed en el colector, y quien la llama lo publica después de su
// commit. No se repite en otro lugar.
export async function moveReservedTable(
  manager: EntityManager,
  statusLog: TableStatusLog,
  afterCommit: AfterCommitEvents,
  move: ReservedTableMove,
): Promise<boolean> {
  const moved = await manager
    .getRepository<TableRow>('Table')
    .update({ id: move.tableId, status: 'reserved' }, { status: move.to });
  if (moved.affected !== 1) {
    return false;
  }
  await recordTableChange(
    statusLog,
    move.restaurantId,
    {
      tableId: move.tableId,
      previousStatus: 'reserved',
      newStatus: move.to,
      userId: move.userId,
      source: move.source,
      changedAt: move.changedAt,
    },
    manager,
    afterCommit,
  );
  return true;
}

// Liberar la mesa: reserved → available. La usan el vencimiento y la cancelación.
export function releaseReservedTable(
  manager: EntityManager,
  statusLog: TableStatusLog,
  afterCommit: AfterCommitEvents,
  release: TableRelease,
): Promise<boolean> {
  return moveReservedTable(manager, statusLog, afterCommit, {
    ...release,
    to: 'available',
  });
}
