import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeORM trata cada export de dist/migrations como una clase de migración y
// hace `new` sobre ella: un export que no sea una clase (una constante, una
// función) rompe migration:run con "migrationClass is not a constructor".
// Cada archivo de src/migrations debe exportar exactamente una clase.
const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const MIGRATION_FILES = readdirSync(DIRECTORY)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .sort();

describe('src/migrations', () => {
  it('finds the migration files', () => {
    expect(MIGRATION_FILES.length).toBeGreaterThan(0);
  });

  it.each(MIGRATION_FILES)('%s exports exactly one class', async (file) => {
    const exported = (await import(join(DIRECTORY, file))) as Record<
      string,
      unknown
    >;

    const entries = Object.entries(exported);
    const notClasses = entries
      .filter(
        ([, value]) =>
          typeof value !== 'function' ||
          !Function.prototype.toString.call(value).startsWith('class'),
      )
      .map(([name]) => name);

    expect(notClasses).toEqual([]);
    expect(entries).toHaveLength(1);
  });
});
