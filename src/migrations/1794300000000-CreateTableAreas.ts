import { MigrationInterface, QueryRunner } from 'typeorm';

// Zones of a restaurant ("Piso 1", "Terraza", "Bar") to organize big
// restaurants: each zone has its own floor plan and the web filters tables by
// zone. Hand-written: the unique index is an expression (lower(trim(name))),
// which TypeORM cannot generate. Additive: every existing table starts
// without zone (area_id NULL) and keeps its place on the plan.
export class CreateTableAreas1794300000000 implements MigrationInterface {
  name = 'CreateTableAreas1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "table_areas" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "restaurant_id" uuid NOT NULL, "name" character varying(30) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_table_areas_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_areas" ADD CONSTRAINT "FK_table_areas_restaurant_id" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_table_areas_restaurant_id_name" ON "table_areas" ("restaurant_id", lower(trim("name")))`,
    );
    await queryRunner.query(`ALTER TABLE "tables" ADD "area_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "tables" ADD CONSTRAINT "FK_tables_area_id" FOREIGN KEY ("area_id") REFERENCES "table_areas"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tables_area_id" ON "tables" ("area_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_tables_area_id"`);
    await queryRunner.query(
      `ALTER TABLE "tables" DROP CONSTRAINT "FK_tables_area_id"`,
    );
    await queryRunner.query(`ALTER TABLE "tables" DROP COLUMN "area_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_table_areas_restaurant_id_name"`,
    );
    await queryRunner.query(`DROP TABLE "table_areas"`);
  }
}
