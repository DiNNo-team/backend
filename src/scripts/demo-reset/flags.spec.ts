import { parseDemoResetArgs, resolveMode, UsageError } from './flags.js';

const nobody = async (): Promise<string | null> => null;

describe('parseDemoResetArgs', () => {
  it('sin flags es dry-run', () => {
    expect(parseDemoResetArgs([])).toEqual({
      apply: false,
      purgeHistory: false,
      confirm: null,
    });
  });

  it('lee --apply, --purge-history y --confirm', () => {
    expect(
      parseDemoResetArgs(['--apply', '--purge-history', '--confirm=mi_base']),
    ).toEqual({ apply: true, purgeHistory: true, confirm: 'mi_base' });
  });

  it('rechaza una opción desconocida', () => {
    expect(() => parseDemoResetArgs(['--aplly'])).toThrow(UsageError);
  });

  it('--confirm sin --apply es un error', () => {
    expect(() => parseDemoResetArgs(['--confirm=x'])).toThrow(UsageError);
  });
});

describe('resolveMode', () => {
  const apply = { apply: true, purgeHistory: false };

  it('sin --apply es dry-run y no pregunta nada', async () => {
    const ask = vi.fn(nobody);
    const mode = await resolveMode(
      { apply: false, purgeHistory: false, confirm: null },
      'base',
      ask,
    );
    expect(mode).toEqual({ kind: 'dry-run' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('--apply sin confirmación (nadie responde) aborta', async () => {
    const mode = await resolveMode({ ...apply, confirm: null }, 'base', nobody);
    expect(mode.kind).toBe('abort');
  });

  it('--apply con confirmación incorrecta aborta', async () => {
    const mode = await resolveMode(
      { ...apply, confirm: 'otra_base' },
      'base',
      nobody,
    );
    expect(mode).toMatchObject({ kind: 'abort' });
  });

  it('--confirm correcto ejecuta sin preguntar', async () => {
    const ask = vi.fn(nobody);
    const mode = await resolveMode({ ...apply, confirm: 'base' }, 'base', ask);
    expect(mode).toEqual({ kind: 'apply' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('la confirmación escrita a mano también sirve (y se ignoran espacios)', async () => {
    const mode = await resolveMode(
      { ...apply, confirm: null },
      'base',
      async () => ' base ',
    );
    expect(mode).toEqual({ kind: 'apply' });
  });

  it('una respuesta incorrecta escrita a mano aborta', async () => {
    const mode = await resolveMode(
      { ...apply, confirm: null },
      'base',
      async () => 'no',
    );
    expect(mode.kind).toBe('abort');
  });
});
