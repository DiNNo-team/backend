import type { QueryRunner } from 'typeorm';
import { AREA_NAME_MAX_LENGTH } from '../modules/restaurant-operations/table-areas/table-area-rules.js';
import { CreateTableAreas1794300000000 } from './1794300000000-CreateTableAreas.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new CreateTableAreas1794300000000()[direction](queryRunner);
  return queries;
}

describe('CreateTableAreas migration', () => {
  it('sizes the name column with the rule of the DTO', async () => {
    const create = (await queriesOf('up')).find((sql) =>
      sql.startsWith('CREATE TABLE "table_areas"'),
    );

    expect(create).toContain(
      `"name" character varying(${AREA_NAME_MAX_LENGTH}) NOT NULL`,
    );
  });

  it('makes the name unique per restaurant without caring about case or spaces', async () => {
    expect(await queriesOf('up')).toContain(
      `CREATE UNIQUE INDEX "UQ_table_areas_restaurant_id_name" ON "table_areas" ("restaurant_id", lower(trim("name")))`,
    );
  });

  it('adds area_id as nullable, so every existing table starts without zone', async () => {
    const queries = await queriesOf('up');

    expect(queries).toContain(`ALTER TABLE "tables" ADD "area_id" uuid`);
    expect(queries.join('\n')).toContain('ON DELETE SET NULL');
  });

  it('undoes everything it adds', async () => {
    const down = (await queriesOf('down')).join('\n');

    expect(down).toContain('DROP INDEX "public"."IDX_tables_area_id"');
    expect(down).toContain('DROP CONSTRAINT "FK_tables_area_id"');
    expect(down).toContain('DROP COLUMN "area_id"');
    expect(down).toContain('DROP TABLE "table_areas"');
  });
});
