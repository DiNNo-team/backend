import { MigrationInterface, QueryRunner } from 'typeorm';

// Table log (PBI 9). The status checks hold the values of TABLE_LOG_STATUSES,
// including 'inactive'; 1791340136261-CreateTableLogs.spec.ts fails if they drift.
export class CreateTableLogs1791340136261 implements MigrationInterface {
  name = 'CreateTableLogs1791340136261';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "table_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "table_id" uuid NOT NULL, "previous_status" character varying(20) NOT NULL, "new_status" character varying(20) NOT NULL, "user_id" uuid NOT NULL, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_table_logs_previous_status" CHECK ("previous_status" IN ('available', 'reserved', 'occupied', 'inactive')), CONSTRAINT "CHK_table_logs_new_status" CHECK ("new_status" IN ('available', 'reserved', 'occupied', 'inactive')), CONSTRAINT "PK_b2259204306e66a7670accce617" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_table_logs_table_id_changed_at" ON "table_logs" ("table_id", "changed_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" ADD CONSTRAINT "FK_609f8b135442da28e86f3e526d1" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" ADD CONSTRAINT "FK_bded364d8f0f3ac6f0fea80da4f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "table_logs" DROP CONSTRAINT "FK_bded364d8f0f3ac6f0fea80da4f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" DROP CONSTRAINT "FK_609f8b135442da28e86f3e526d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_table_logs_table_id_changed_at"`,
    );
    await queryRunner.query(`DROP TABLE "table_logs"`);
  }
}
