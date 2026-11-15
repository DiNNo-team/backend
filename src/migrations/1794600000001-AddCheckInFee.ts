import { MigrationInterface, QueryRunner } from 'typeorm';

// Cobro por check-in (CLAUDE.md §11, "Cobro por check-in"). Escrita a mano.
//
// fee_cop: la tarifa en COP que se cobró por ese check-in (snapshot de
// CHECKIN_FEE_COP en ese momento). Se agrega con DEFAULT 2000 para que todos los
// check-ins existentes queden con 2000 en la misma sentencia, y en seguida se
// quita el default: el código siempre la fija, y un INSERT que no la fije falla
// por NOT NULL (nunca se cobra una tarifa por accidente).
// IDX_check_ins_restaurant_id_checked_in_at: el estado de cuenta y el resumen
// filtran por restaurante y rango de checked_in_at, y el estado de cuenta ordena
// por checked_in_at. Depende de CreateCheckIns.
// 1794600000001-AddCheckInFee.spec.ts fija las sentencias.
export class AddCheckInFee1794600000001 implements MigrationInterface {
  name = 'AddCheckInFee1794600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "check_ins" ADD "fee_cop" integer NOT NULL DEFAULT 2000`,
    );
    await queryRunner.query(
      `ALTER TABLE "check_ins" ALTER COLUMN "fee_cop" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "check_ins" ADD CONSTRAINT "CHK_check_ins_fee_cop" CHECK ("fee_cop" >= 0)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_check_ins_restaurant_id_checked_in_at" ON "check_ins" ("restaurant_id", "checked_in_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_check_ins_restaurant_id_checked_in_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "check_ins" DROP CONSTRAINT "CHK_check_ins_fee_cop"`,
    );
    await queryRunner.query(`ALTER TABLE "check_ins" DROP COLUMN "fee_cop"`);
  }
}
