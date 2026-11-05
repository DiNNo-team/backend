import type { EntityManager } from 'typeorm';
import type { TableStatusLog } from '../../restaurant-operations/index.js';

// La mesa se lee y escribe por nombre de entidad (es de restaurant-operations).
interface TableRow {
  id: string;
  status: string;
}

// Quién libera la mesa y por qué (§12.3): el vencimiento es automático (sin
// usuario, source 'system'); la cancelación es del comensal (source 'reservation').
export interface TableRelease {
  tableId: string;
  userId: string | null;
  source: 'reservation' | 'system';
  changedAt: Date;
}

// LA regla de "liberar la mesa de una reserva que termina": reserved → available
// SOLO si la mesa sigue reserved (el UPDATE lleva la condición). Nunca se pisa un
// estado que el restaurante cambió después. La bitácora se escribe solo si la
// mesa realmente cambió. Devuelve true si cambió.
//
// No abre transacciones ni emite eventos: actúa con el manager recibido, y quien
// lo llama emite el evento después de su commit. La usan el vencimiento y la
// cancelación; no se repite en otro lugar.
export async function releaseReservedTable(
  manager: EntityManager,
  statusLog: TableStatusLog,
  release: TableRelease,
): Promise<boolean> {
  const released = await manager
    .getRepository<TableRow>('Table')
    .update(
      { id: release.tableId, status: 'reserved' },
      { status: 'available' },
    );
  if (released.affected !== 1) {
    return false;
  }
  await statusLog.record(
    {
      tableId: release.tableId,
      previousStatus: 'reserved',
      newStatus: 'available',
      userId: release.userId,
      source: release.source,
      changedAt: release.changedAt,
    },
    manager,
  );
  return true;
}
