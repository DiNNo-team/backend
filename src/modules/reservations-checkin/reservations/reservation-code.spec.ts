import {
  RESERVATION_CODE_ALPHABET,
  RESERVATION_CODE_LENGTH,
} from './reservation.constants.js';
import { RandomCodeGenerator } from './reservation-code.js';

describe('RandomCodeGenerator', () => {
  const codes = Array.from({ length: 2000 }, () =>
    new RandomCodeGenerator().generate(),
  );

  it('genera códigos de 6 caracteres', () => {
    expect(RESERVATION_CODE_LENGTH).toBe(6);
    for (const code of codes) {
      expect(code).toHaveLength(6);
    }
  });

  it('usa solo caracteres del alfabeto', () => {
    const allowed = new Set(RESERVATION_CODE_ALPHABET);
    for (const code of codes) {
      for (const character of code) {
        expect(allowed.has(character)).toBe(true);
      }
    }
  });

  it('nunca incluye los caracteres que se confunden: 0 O 1 I L', () => {
    for (const code of codes) {
      expect(code).not.toMatch(/[01OIL]/);
    }
    expect(RESERVATION_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('el alfabeto tiene 31 caracteres distintos', () => {
    expect(RESERVATION_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(RESERVATION_CODE_ALPHABET).size).toBe(31);
  });

  it('no repite siempre el mismo código y recorre buena parte del alfabeto', () => {
    expect(new Set(codes).size).toBeGreaterThan(1990);
    expect(new Set(codes.join('')).size).toBe(31);
  });
});
