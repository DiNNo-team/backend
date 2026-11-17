import { MigrationInterface, QueryRunner } from 'typeorm';

// Índices para los reportes de toda la plataforma (panel del administrador,
// Sprint 4): filtran solo por fecha, sin restaurante, así que los índices que
// empiezan por restaurant_id no sirven. Sin CONCURRENTLY: TypeORM corre las
// migraciones en una transacción y las tablas son pequeñas (riesgo aceptado,
// ver AVISOS.md).
export class AddPlatformReportIndexes1794700000002 implements MigrationInterface {
  name = 'AddPlatformReportIndexes1794700000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_check_ins_checked_in_at" ON "check_ins" ("checked_in_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_created_at" ON "reservations" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reservations_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_check_ins_checked_in_at"`,
    );
  }
}
