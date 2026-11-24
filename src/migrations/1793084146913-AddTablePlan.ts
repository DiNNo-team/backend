import { MigrationInterface, QueryRunner } from 'typeorm';

// Floor plan of the tables (identity manual v2.0, 13.10): the top-left cell of
// each placed table and its shape. Hand-written: the checks are named by hand
// and hold the values of table-plan.ts (PLAN_COLUMNS, PLAN_ROWS, TABLE_SHAPES);
// 1793084146913-AddTablePlan.spec.ts fails if they drift. Additive and
// nullable: every existing table starts unplaced.
export class AddTablePlan1793084146913 implements MigrationInterface {
  name = 'AddTablePlan1793084146913';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tables" ADD "plan_x" smallint`);
    await queryRunner.query(`ALTER TABLE "tables" ADD "plan_y" smallint`);
    await queryRunner.query(
      `ALTER TABLE "tables" ADD "plan_shape" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" ADD CONSTRAINT "CHK_tables_plan_pair" CHECK (("plan_x" IS NULL AND "plan_y" IS NULL) OR ("plan_x" IS NOT NULL AND "plan_y" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" ADD CONSTRAINT "CHK_tables_plan_x" CHECK ("plan_x" BETWEEN 0 AND 19)`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" ADD CONSTRAINT "CHK_tables_plan_y" CHECK ("plan_y" BETWEEN 0 AND 29)`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" ADD CONSTRAINT "CHK_tables_plan_shape" CHECK ("plan_shape" IN ('square', 'round', 'rect'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tables" DROP CONSTRAINT "CHK_tables_plan_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" DROP CONSTRAINT "CHK_tables_plan_y"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" DROP CONSTRAINT "CHK_tables_plan_x"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tables" DROP CONSTRAINT "CHK_tables_plan_pair"`,
    );
    await queryRunner.query(`ALTER TABLE "tables" DROP COLUMN "plan_shape"`);
    await queryRunner.query(`ALTER TABLE "tables" DROP COLUMN "plan_y"`);
    await queryRunner.query(`ALTER TABLE "tables" DROP COLUMN "plan_x"`);
  }
}
