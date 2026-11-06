import { normalizeCheckInCode } from './check-in-code.js';

describe('normalizeCheckInCode', () => {
  it.each([
    ['K7M4QX', 'K7M4QX'],
    ['k7m4qx', 'K7M4QX'],
    ['  K7M4QX  ', 'K7M4QX'],
    ['k7m 4qx', 'K7M4QX'],
    ['k 7 m 4 q x', 'K7M4QX'],
    ['k7m\t4qx\n', 'K7M4QX'],
  ])('%j se normaliza a %s', (raw, expected) => {
    expect(normalizeCheckInCode(raw)).toBe(expected);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['corto', 'K7M4Q'],
    ['largo', 'K7M4QXX'],
    ['con 0, que no está en el alfabeto', 'K7M0QX'],
    ['con O', 'K7MOQX'],
    ['con 1', 'K7M1QX'],
    ['con I', 'K7MIQX'],
    ['con L', 'K7MLQX'],
    ['con símbolos', 'K7M-QX'],
    ['con tildes', 'K7MÁQX'],
  ])('rechaza un código %s', (_case, raw) => {
    expect(normalizeCheckInCode(raw)).toBeNull();
  });
});
