import type { QueryRunner } from 'typeorm';
import { BILLING_PERIOD_STATUSES } from '../modules/reservations-checkin/billing/billing-period.entity.js';
import { CreateBillingPeriods1794700000001 } from './1794700000001-CreateBillingPeriods.js';

async function queriesOf(direction: 'up' | 'down'): Promise<string[]> {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  await new CreateBillingPeriods1794700000001()[direction](queryRunner);
  return queries;
}

describe('CreateBillingPeriods migration', () => {
  it('one row per restaurant and month, with the statuses of the entity', async () => {
    const create = (await queriesOf('up')).find((sql) =>
      sql.startsWith('CREATE TABLE "billing_periods"'),
    );

    expect(create).toContain(
      'CONSTRAINT "UQ_billing_periods_restaurant_id_period_month" UNIQUE ("restaurant_id", "period_month")',
    );
    expect(create).toContain(
      `CHECK ("status" IN (${BILLING_PERIOD_STATUSES.map((s) => `'${s}'`).join(', ')}))`,
    );
    expect(create).toContain('EXTRACT(DAY FROM "period_month") = 1');
    // Sin valor por defecto en status: el código siempre lo fija.
    expect(create).toContain('"status" character varying(10) NOT NULL,');
    expect(create).toContain('"CHK_billing_periods_paid_fields"');
  });

  it('links the restaurant and the admin who marked it with named foreign keys', async () => {
    const queries = (await queriesOf('up')).join('\n');

    expect(queries).toContain(
      'ADD CONSTRAINT "FK_billing_periods_restaurant_id" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")',
    );
    expect(queries).toContain(
      'ADD CONSTRAINT "FK_billing_periods_marked_paid_by" FOREIGN KEY ("marked_paid_by") REFERENCES "users"("id")',
    );
  });

  it('down drops the table', async () => {
    expect(await queriesOf('down')).toEqual(['DROP TABLE "billing_periods"']);
  });
});
