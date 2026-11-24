import {
  canSeatParty,
  type TableSnapshot,
} from '../../search-availability/index.js';

// Mesa candidata: lo que la regla de disponibilidad necesita más su
// identificador, que desempata.
export interface CandidateTable extends TableSnapshot {
  id: string;
  identifier: string;
}

// "2" antes que "10" (orden numérico) y "T1" después de los números.
function compareIdentifiers(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true });
}

// Asignación de mesa (§12.1): solo las que pueden recibir al grupo (activa,
// Disponible y con capacidad suficiente, la misma regla de la búsqueda), de la
// más pequeña a la más grande; a igual capacidad, la de identificador menor.
// Así no se gasta una mesa de 8 en una pareja.
//
// Devuelve TODAS las candidatas, ya ordenadas: el servicio las recorre en ese
// orden e intenta bloquear una a una (si otra transacción tiene una bloqueada,
// pasa a la siguiente). No muta la lista que recibe.
export function rankCandidateTables<T extends CandidateTable>(
  tables: readonly T[],
  partySize: number,
): T[] {
  return tables
    .filter((table) => canSeatParty(table, partySize))
    .sort(
      (a, b) =>
        a.capacity - b.capacity ||
        compareIdentifiers(a.identifier, b.identifier),
    );
}
