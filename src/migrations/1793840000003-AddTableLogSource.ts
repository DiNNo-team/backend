import { MigrationInterface, QueryRunner } from 'typeorm';

// Origen de cada registro de la bitácora (Sprint 3, CLAUDE.md §12.3). Escrita a
// mano: los checks guardan los valores de TABLE_LOG_SOURCES
// (tables/table-status-log.ts); 1793840000003-AddTableLogSource.spec.ts falla
// si se desalinean. Los registros existentes quedan con source = 'manual'.
// user_id solo puede ser NULL cuando source = 'system' (el vencimiento
// automático de una reserva); la FK a users se conserva.
export class AddTableLogSource1793840000003 implements MigrationInterface {
  name = 'AddTableLogSource1793840000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "table_logs" ADD "source" character varying(20) NOT NULL DEFAULT 'manual'`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" ADD CONSTRAINT "CHK_table_logs_source" CHECK ("source" IN ('manual', 'reservation', 'system'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" ALTER COLUMN "user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" ADD CONSTRAINT "CHK_table_logs_user_required_unless_system" CHECK ("user_id" IS NOT NULL OR "source" = 'system')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "table_logs" DROP CONSTRAINT "CHK_table_logs_user_required_unless_system"`,
    );
    // Antes de este cambio no existían registros sin usuario: se borran los
    // automáticos para poder volver a exigir user_id. Es lo único que se pierde.
    await queryRunner.query(`DELETE FROM "table_logs" WHERE "user_id" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "table_logs" ALTER COLUMN "user_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "table_logs" DROP CONSTRAINT "CHK_table_logs_source"`,
    );
    await queryRunner.query(`ALTER TABLE "table_logs" DROP COLUMN "source"`);
  }
}
