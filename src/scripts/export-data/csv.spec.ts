import { escapeCsvField, formatCsvValue, toCsv } from './csv.js';

describe('escapeCsvField', () => {
  it('deja igual un texto simple', () => {
    expect(escapeCsvField('abc 123')).toBe('abc 123');
  });

  it.each([
    ['a,b', '"a,b"'],
    ['dijo "hola"', '"dijo ""hola"""'],
    ['línea1\nlínea2', '"línea1\nlínea2"'],
    ['línea1\r\nlínea2', '"línea1\r\nlínea2"'],
  ])('escapa %j', (input, expected) => {
    expect(escapeCsvField(input)).toBe(expected);
  });
});

describe('formatCsvValue', () => {
  it('vacía null y undefined', () => {
    expect(formatCsvValue(null)).toBe('');
    expect(formatCsvValue(undefined)).toBe('');
  });

  it('formatea fechas en ISO UTC, números y booleanos', () => {
    expect(formatCsvValue(new Date('2026-11-06T01:02:03Z'))).toBe(
      '2026-11-06T01:02:03.000Z',
    );
    expect(formatCsvValue(0)).toBe('0');
    expect(formatCsvValue(false)).toBe('false');
  });
});

describe('toCsv', () => {
  it('escribe la cabecera y las filas con salto final', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', 'x,y'],
          [2, null],
        ],
      ),
    ).toBe('a,b\n1,"x,y"\n2,\n');
  });

  it('sin filas lleva solo la cabecera', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\n');
  });
});
