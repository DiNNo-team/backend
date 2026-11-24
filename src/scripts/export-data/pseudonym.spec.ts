import { createPseudonymizer, newSalt } from './pseudonym.js';

const ID = '37feb934-a3e9-4896-9bde-473ec298c396';

describe('createPseudonymizer', () => {
  it('es consistente dentro de una exportación (misma sal)', () => {
    const pseudonym = createPseudonymizer(newSalt());
    expect(pseudonym(ID)).toBe(pseudonym(ID));
    expect(pseudonym(ID)).not.toBe(pseudonym('otro-id'));
  });

  it('cambia con otra sal', () => {
    expect(createPseudonymizer(newSalt())(ID)).not.toBe(
      createPseudonymizer(newSalt())(ID),
    );
  });

  it('mide 16 caracteres hexadecimales y no contiene el id', () => {
    const value = createPseudonymizer(newSalt())(ID);
    expect(value).toMatch(/^[0-9a-f]{16}$/);
    expect(value).not.toContain(ID.slice(0, 8));
  });

  it('genera sales distintas de 32 bytes', () => {
    expect(newSalt()).toHaveLength(32);
    expect(newSalt().equals(newSalt())).toBe(false);
  });
});
