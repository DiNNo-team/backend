import {
  rankCandidateTables,
  type CandidateTable,
} from './table-assignment.js';

let nextId = 0;
const table = (
  identifier: string,
  capacity: number,
  overrides: Partial<CandidateTable> = {},
): CandidateTable => ({
  id: `table-${(nextId += 1)}`,
  identifier,
  capacity,
  status: 'available',
  isActive: true,
  ...overrides,
});

const identifiers = (tables: CandidateTable[]) =>
  tables.map((candidate) => candidate.identifier);

describe('rankCandidateTables', () => {
  it('pone primero la más pequeña que alcanza: no gasta una mesa de 8 en una pareja', () => {
    const tables = [table('A', 8), table('B', 4), table('C', 2)];

    expect(identifiers(rankCandidateTables(tables, 2))).toEqual([
      'C',
      'B',
      'A',
    ]);
    expect(identifiers(rankCandidateTables(tables, 3))).toEqual(['B', 'A']);
  });

  it('a igual capacidad, la de identificador menor', () => {
    const tables = [table('T2', 4), table('T1', 4), table('T3', 4)];

    expect(identifiers(rankCandidateTables(tables, 4))).toEqual([
      'T1',
      'T2',
      'T3',
    ]);
  });

  it('ordena los identificadores numéricos como números: "2" antes que "10"', () => {
    const tables = [table('10', 4), table('2', 4), table('01', 4)];

    expect(identifiers(rankCandidateTables(tables, 4))).toEqual([
      '01',
      '2',
      '10',
    ]);
  });

  it('la capacidad manda sobre el identificador', () => {
    const tables = [table('01', 6), table('09', 2)];

    expect(identifiers(rankCandidateTables(tables, 2))).toEqual(['09', '01']);
  });

  it('ignora las mesas inactivas', () => {
    const tables = [table('A', 2, { isActive: false }), table('B', 4)];

    expect(identifiers(rankCandidateTables(tables, 2))).toEqual(['B']);
  });

  it.each(['reserved', 'occupied'] as const)(
    'ignora una mesa %s a mano: nunca se asigna',
    (status) => {
      const tables = [table('A', 2, { status }), table('B', 4)];

      expect(identifiers(rankCandidateTables(tables, 2))).toEqual(['B']);
    },
  );

  it('devuelve una lista vacía si ninguna cabe', () => {
    const tables = [table('A', 2), table('B', 4)];

    expect(rankCandidateTables(tables, 5)).toEqual([]);
    expect(rankCandidateTables([], 1)).toEqual([]);
  });

  it('la capacidad justa alcanza (capacidad igual a las personas)', () => {
    expect(identifiers(rankCandidateTables([table('A', 4)], 4))).toEqual(['A']);
  });

  it('devuelve TODAS las candidatas, ya ordenadas, para que el servicio las recorra en ese orden', () => {
    const tables = [table('D', 6), table('B', 2), table('C', 2), table('A', 4)];

    expect(identifiers(rankCandidateTables(tables, 1))).toEqual([
      'B',
      'C',
      'A',
      'D',
    ]);
  });

  it('no muta la lista que recibe', () => {
    const tables = [table('B', 4), table('A', 2)];
    const before = [...tables];

    rankCandidateTables(tables, 1);

    expect(tables).toEqual(before);
  });
});
