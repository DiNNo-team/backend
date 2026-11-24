import { bogotaParts } from './bogota-parts.js';
import {
  CHECK_IN_COLUMNS,
  columnNames,
  RESERVATION_COLUMNS,
  TABLE_LOG_COLUMNS,
} from './columns.js';
import type { CsvValue } from './csv.js';
import type { Pseudonymizer } from './pseudonym.js';

// Filas tal como salen de la base, ya con nombres en camelCase.
export interface ReservationSource {
  id: string;
  dinerId: string;
  restaurantId: string;
  category: string | null;
  tableCapacity: number;
  partySize: number;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  expiredAt: Date | null;
  cancelledAt: Date | null;
  checkedInAt: Date | null;
  noShow: boolean;
}

export interface CheckInSource {
  id: string;
  reservationId: string;
  restaurantId: string;
  checkedInAt: Date;
}

export interface TableLogSource {
  id: string;
  restaurantId: string;
  tableId: string;
  previousStatus: string;
  newStatus: string;
  source: string;
  changedAt: Date;
  // Rol del usuario que hizo el cambio; null si no hubo usuario.
  actorRole: string | null;
}

export const RESERVATIONS_HEADER = columnNames(RESERVATION_COLUMNS);
export const CHECK_INS_HEADER = columnNames(CHECK_IN_COLUMNS);
export const TABLE_LOGS_HEADER = columnNames(TABLE_LOG_COLUMNS);

// Segundos hasta el cierre de la reserva; null mientras sigue activa.
export function secondsToResolve(
  reservation: ReservationSource,
): number | null {
  const closedAt =
    reservation.cancelledAt ?? reservation.expiredAt ?? reservation.checkedInAt;
  if (closedAt === null) {
    return null;
  }
  return Math.round(
    (closedAt.getTime() - reservation.createdAt.getTime()) / 1000,
  );
}

export function reservationRow(
  reservation: ReservationSource,
  pseudonymize: Pseudonymizer,
): CsvValue[] {
  const { dayOfWeek, hourOfDay } = bogotaParts(reservation.createdAt);
  return [
    reservation.id,
    pseudonymize(reservation.dinerId),
    reservation.restaurantId,
    reservation.category,
    reservation.tableCapacity,
    reservation.partySize,
    reservation.status,
    reservation.createdAt,
    reservation.expiresAt,
    reservation.expiredAt,
    reservation.cancelledAt,
    reservation.checkedInAt,
    reservation.noShow,
    dayOfWeek,
    hourOfDay,
    secondsToResolve(reservation),
  ];
}

export function checkInRow(checkIn: CheckInSource): CsvValue[] {
  const { dayOfWeek, hourOfDay } = bogotaParts(checkIn.checkedInAt);
  return [
    checkIn.id,
    checkIn.reservationId,
    checkIn.restaurantId,
    checkIn.checkedInAt,
    dayOfWeek,
    hourOfDay,
  ];
}

// Solo el tipo de quien actuó: sin usuario es el sistema.
export function actorType(actorRole: string | null): string {
  return actorRole ?? 'system';
}

export function tableLogRow(log: TableLogSource): CsvValue[] {
  return [
    log.id,
    log.restaurantId,
    log.tableId,
    log.previousStatus,
    log.newStatus,
    log.source,
    log.changedAt,
    actorType(log.actorRole),
  ];
}
