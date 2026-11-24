import type { TableChange, TableState } from './plan.js';

// Qué hará (o hizo) demo:reset. Sin ningún dato personal: solo conteos e
// identificadores de mesa.
export interface HistoryPurge {
  checkIns: number;
  reservations: number;
  tableLogs: number;
}

export interface DemoResetSummary {
  restaurantId: string;
  restaurantName: string;
  // Reservas active que se cancelan (con --purge-history se borran en su lugar).
  activeReservations: number;
  tableChanges: TableChange[];
  unchangedTables: number;
  missingTables: string[];
  // null si no se pidió --purge-history.
  purge: HistoryPurge | null;
}

function describeState({ status, isActive, capacity }: TableState): string {
  return `${isActive ? status : `inactiva (${status})`}, ${capacity} personas`;
}

// Líneas para imprimir. `executed` cambia solo los verbos (haría / hizo).
export function formatSummary(
  summary: DemoResetSummary,
  executed: boolean,
): string[] {
  const would = executed ? '' : 'haría: ';
  const lines = [`Restaurante: ${summary.restaurantName}`];

  if (summary.purge) {
    const { checkIns, reservations, tableLogs } = summary.purge;
    lines.push(
      `- ${would}borrar ${checkIns} check-ins, ${reservations} reservas (${summary.activeReservations} activas) y ${tableLogs} filas de bitácora (source reservation o system)`,
    );
  } else {
    lines.push(
      `- ${would}cancelar ${summary.activeReservations} reservas activas (no se borran)`,
    );
  }

  if (summary.tableChanges.length === 0) {
    lines.push(
      `- mesas: ya están en el estado inicial (${summary.unchangedTables})`,
    );
  }
  for (const change of summary.tableChanges) {
    lines.push(
      `- ${change.identifier}: ${describeState(change.from)} → ${describeState(change.to)} (${change.logSteps.length} filas de bitácora)`,
    );
  }
  if (summary.tableChanges.length > 0) {
    lines.push(`- mesas sin cambios: ${summary.unchangedTables}`);
  }
  for (const identifier of summary.missingTables) {
    lines.push(
      `- AVISO: ${identifier} no existe en el restaurante; el script no crea mesas`,
    );
  }
  return lines;
}
