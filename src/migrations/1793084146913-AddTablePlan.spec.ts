import type { QueryRunner } from 'typeorm';
import {
  PLAN_COLUMNS,
  PLAN_ROWS,
  TABLE_SHAPES,
} from '../modules/restaurant-operations/tables/table-plan.js';
import { AddTablePlan1793084146913 } from './1793084146913-AddTablePlan.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new AddTablePlan1793084146913()[direction](queryRunner);
  return queries;
}

const checkOf = (queries: string[], name: string) =>
  queries.find((sql) => sql.includes(`"${name}"`)) ?? '';

describe('AddTablePlan migration', () => {
  it('adds the three columns as nullable, so every existing table starts unplaced', async () => {
    const queries = await queriesOf('up');

    expect(queries).toContain(`ALTER TABLE "tables" ADD "plan_x" smallint`);
    expect(queries).toContain(`ALTER TABLE "tables" ADD "plan_y" smallint`);
    expect(queries).toContain(
      `ALTER TABLE "tables" ADD "plan_shape" character varying(10)`,
    );
    for (const sql of queries.filter((query) => query.includes('ADD "plan_'))) {
      expect(sql).not.toContain('NOT NULL');
    }
  });

  it('bounds the cells with exactly the grid of table-plan.ts', async () => {
    const queries = await queriesOf('up');

    expect(checkOf(queries, 'CHK_tables_plan_x')).toContain(
      `"plan_x" BETWEEN 0 AND ${PLAN_COLUMNS - 1}`,
    );
    expect(checkOf(queries, 'CHK_tables_plan_y')).toContain(
      `"plan_y" BETWEEN 0 AND ${PLAN_ROWS - 1}`,
    );
  });

  it('checks plan_shape against exactly TABLE_SHAPES', async () => {
    const values = /IN \(([^)]*)\)/
      .exec(checkOf(await queriesOf('up'), 'CHK_tables_plan_shape'))?.[1]
      .split(',')
      .map((value) => value.trim().replace(/'/g, ''));

    expect(values).toEqual([...TABLE_SHAPES]);
  });

  it('undoes everything it adds', async () => {
    const down = (await queriesOf('down')).join('\n');

    for (const name of [
      'CHK_tables_plan_pair',
      'CHK_tables_plan_x',
      'CHK_tables_plan_y',
      'CHK_tables_plan_shape',
    ]) {
      expect(down).toContain(`DROP CONSTRAINT "${name}"`);
    }
    for (const column of ['plan_x', 'plan_y', 'plan_shape']) {
      expect(down).toContain(`DROP COLUMN "${column}"`);
    }
  });
});
