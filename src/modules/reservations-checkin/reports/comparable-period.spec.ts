import { previousComparablePeriod } from './comparable-period.js';

const NOW = new Date('2028-12-17T15:00:00Z');

function of(from: string, to: string): [string, string] {
  const result = previousComparablePeriod({ from, to }, NOW);
  return [result.from, result.to];
}

describe('previousComparablePeriod', () => {
  it('toma el mismo tramo del mes anterior', () => {
    expect(of('2026-11-01', '2026-11-17')).toEqual([
      '2026-10-01',
      '2026-10-17',
    ]);
  });

  it('un mes completo se compara con el mes completo anterior', () => {
    expect(of('2026-11-01', '2026-11-30')).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);
    expect(of('2026-10-01', '2026-10-31')).toEqual([
      '2026-09-01',
      '2026-09-30',
    ]);
  });

  it('recorta al último día de un mes más corto', () => {
    expect(of('2026-03-01', '2026-03-31')).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    expect(of('2026-03-01', '2026-03-30')).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    expect(of('2026-03-01', '2026-03-29')).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    expect(of('2026-03-01', '2026-03-28')).toEqual([
      '2026-02-01',
      '2026-02-28',
    ]);
    expect(of('2026-03-01', '2026-03-15')).toEqual([
      '2026-02-01',
      '2026-02-15',
    ]);
  });

  it('respeta el año bisiesto', () => {
    expect(of('2028-03-01', '2028-03-31')).toEqual([
      '2028-02-01',
      '2028-02-29',
    ]);
    expect(of('2028-03-01', '2028-03-30')).toEqual([
      '2028-02-01',
      '2028-02-29',
    ]);
    expect(of('2028-03-01', '2028-03-10')).toEqual([
      '2028-02-01',
      '2028-02-10',
    ]);
  });

  it('un mes de 31 días contra uno de 30 sigue el último día', () => {
    expect(of('2026-05-01', '2026-05-31')).toEqual([
      '2026-04-01',
      '2026-04-30',
    ]);
  });

  it('cruza el año en enero', () => {
    expect(of('2026-01-01', '2026-01-17')).toEqual([
      '2025-12-01',
      '2025-12-17',
    ]);
  });

  it('un periodo que no empieza el día 1 toma los mismos días justo antes', () => {
    expect(of('2026-11-03', '2026-11-10')).toEqual([
      '2026-10-26',
      '2026-11-02',
    ]);
  });

  it('un periodo que cruza meses también toma los días justo antes', () => {
    expect(of('2026-10-20', '2026-11-05')).toEqual([
      '2026-10-03',
      '2026-10-19',
    ]);
    expect(of('2026-09-01', '2026-11-17')).toEqual([
      '2026-06-15',
      '2026-08-31',
    ]);
  });

  it('un solo día se compara con el día anterior', () => {
    expect(of('2026-11-10', '2026-11-10')).toEqual([
      '2026-11-09',
      '2026-11-09',
    ]);
  });
});
