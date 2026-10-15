import { Module, type DynamicModule } from '@nestjs/common';
import { DataSource, FindOperator } from 'typeorm';

// In-memory stand-in for the read-only readers that use
// DataSource.getRepository('<Entity>').find / findOne (search-availability).
// No PostgreSQL: the rows are filtered here the way Postgres would.

export type Row = Record<string, unknown>;

export interface FindOptions {
  where: Record<string, unknown>;
  select: Record<string, true>;
}

// What Postgres does with the find options the readers send: Between and In
// on a column (NULL never matches) and equality.
export function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([column, condition]) => {
    const value = row[column];
    if (!(condition instanceof FindOperator)) {
      return value === condition;
    }
    if (condition.type === 'between') {
      const [min, max] = condition.value as unknown as [number, number];
      return typeof value === 'number' && value >= min && value <= max;
    }
    if (condition.type === 'in') {
      return (condition.value as unknown as unknown[]).includes(value);
    }
    throw new Error(`Operator not simulated: ${condition.type}`);
  });
}

// find and findOne over fixed rows; select keeps only those columns. Both are
// vi.fn, so a test can check whether the database was queried.
export function fakeRepository(rows: Row[]) {
  const find = (options: FindOptions) =>
    rows
      .filter((row) => matches(row, options.where))
      .map((row) =>
        Object.fromEntries(
          Object.keys(options.select).map((column) => [column, row[column]]),
        ),
      );
  return {
    find: vi.fn((options: FindOptions) => Promise.resolve(find(options))),
    findOne: vi.fn((options: FindOptions) =>
      Promise.resolve(find(options)[0] ?? null),
    ),
  };
}

export type FakeRepository = ReturnType<typeof fakeRepository>;

// In the app, TypeOrmModule.forRoot provides DataSource globally; here a
// stand-in that answers by entity name. Import FakeDatabaseModule.with({...}).
@Module({})
export class FakeDatabaseModule {
  static with(repositories: Record<string, FakeRepository>): DynamicModule {
    return {
      module: FakeDatabaseModule,
      global: true,
      providers: [
        {
          provide: DataSource,
          useValue: {
            getRepository: (name: string) => {
              const repository = repositories[name];
              if (!repository) {
                throw new Error(`Repository not simulated: ${name}`);
              }
              return repository;
            },
          },
        },
      ],
      exports: [DataSource],
    };
  }
}
