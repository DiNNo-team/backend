import type { SqlRunner } from '../shared/sql-runner.js';
import type {
  CheckInSource,
  ReservationSource,
  TableLogSource,
} from './rows.js';

// Lectura de los tres conjuntos. Solo SELECT, y siempre dentro de la
// transacción de solo lectura que abre run-export.ts. Nada de correos, nombres,
// códigos ni coordenadas: ni siquiera se piden a la base.
// Se carga todo en memoria: alcanza para el volumen del piloto; si crece, se
// pasa a lectura por lotes.

export interface ExportData {
  reservations: ReservationSource[];
  checkIns: CheckInSource[];
  tableLogs: TableLogSource[];
}

export async function readExportData(runner: SqlRunner): Promise<ExportData> {
  const reservations = await runner.query<ReservationSource>(
    `SELECT r.id,
            r.diner_id AS "dinerId",
            r.restaurant_id AS "restaurantId",
            rest.category AS "category",
            t.capacity AS "tableCapacity",
            r.party_size AS "partySize",
            r.status,
            r.created_at AS "createdAt",
            r.expires_at AS "expiresAt",
            r.expired_at AS "expiredAt",
            r.cancelled_at AS "cancelledAt",
            r.checked_in_at AS "checkedInAt",
            r.no_show AS "noShow"
       FROM reservations r
       JOIN restaurants rest ON rest.id = r.restaurant_id
       JOIN tables t ON t.id = r.table_id
      ORDER BY r.created_at, r.id`,
  );
  const checkIns = await runner.query<CheckInSource>(
    `SELECT id,
            reservation_id AS "reservationId",
            restaurant_id AS "restaurantId",
            checked_in_at AS "checkedInAt"
       FROM check_ins
      ORDER BY checked_in_at, id`,
  );
  const tableLogs = await runner.query<TableLogSource>(
    `SELECT l.id,
            t.restaurant_id AS "restaurantId",
            l.table_id AS "tableId",
            l.previous_status AS "previousStatus",
            l.new_status AS "newStatus",
            l.source,
            l.changed_at AS "changedAt",
            u.role AS "actorRole"
       FROM table_logs l
       JOIN tables t ON t.id = l.table_id
       LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.changed_at, l.id`,
  );
  return {
    reservations: reservations.rows,
    checkIns: checkIns.rows,
    tableLogs: tableLogs.rows,
  };
}
