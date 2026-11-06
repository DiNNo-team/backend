export interface DemoResetFlags {
  apply: boolean;
  purgeHistory: boolean;
  // Nombre de la base que se confirma sin preguntar; null si no se pasó.
  confirm: string | null;
}

export class UsageError extends Error {}

const CONFIRM_PREFIX = '--confirm=';

// Por defecto es DRY-RUN: sin --apply no se escribe nada.
export function parseDemoResetArgs(args: readonly string[]): DemoResetFlags {
  const flags: DemoResetFlags = {
    apply: false,
    purgeHistory: false,
    confirm: null,
  };
  for (const arg of args) {
    if (arg === '--apply') {
      flags.apply = true;
    } else if (arg === '--purge-history') {
      flags.purgeHistory = true;
    } else if (arg.startsWith(CONFIRM_PREFIX)) {
      flags.confirm = arg.slice(CONFIRM_PREFIX.length);
    } else {
      throw new UsageError(
        `Opción desconocida: ${arg}. Usa --apply, --confirm=<base> y --purge-history.`,
      );
    }
  }
  if (flags.confirm !== null && !flags.apply) {
    throw new UsageError('--confirm solo se usa junto con --apply.');
  }
  return flags;
}

export type ExecutionMode =
  { kind: 'dry-run' } | { kind: 'apply' } | { kind: 'abort'; reason: string };

// Decide si se escribe. Para ejecutar hace falta --apply Y que se confirme el
// nombre exacto de la base: con --confirm=<base> o escribiéndolo cuando se
// pregunta. `askConfirmation` devuelve null si no hay quien responda (sin
// terminal): eso aborta.
export async function resolveMode(
  flags: DemoResetFlags,
  databaseName: string,
  askConfirmation: () => Promise<string | null>,
): Promise<ExecutionMode> {
  if (!flags.apply) {
    return { kind: 'dry-run' };
  }
  const typed = flags.confirm ?? (await askConfirmation());
  if (typed === null || typed.trim() === '') {
    return {
      kind: 'abort',
      reason: `Falta la confirmación: pasa --confirm=${databaseName} o escribe el nombre de la base. No se escribió nada.`,
    };
  }
  if (typed.trim() !== databaseName) {
    return {
      kind: 'abort',
      reason:
        'La confirmación no coincide con el nombre de la base. No se escribió nada.',
    };
  }
  return { kind: 'apply' };
}
