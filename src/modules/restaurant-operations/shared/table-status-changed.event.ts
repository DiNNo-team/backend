import type {
  TableLogSource,
  TableLogStatus,
} from '../tables/table-status-log.js';

// Evento interno (EventEmitter2): entró una fila nueva a la bitácora de mesas.
// Sale una vez por fila, después del commit y con los mismos valores de la fila
// (CLAUDE.md §12.8). Lo produce solo recordTableChange (tables/table-status-log.ts).
// restaurant-operations no sabe quién escucha; restaurantId sirve para elegir la
// sala y no llega al cliente.
export const TABLE_STATUS_CHANGED = 'table.status-changed';

export interface TableStatusChangedEvent {
  restaurantId: string;
  tableId: string;
  previousStatus: TableLogStatus;
  status: TableLogStatus;
  source: TableLogSource;
}
