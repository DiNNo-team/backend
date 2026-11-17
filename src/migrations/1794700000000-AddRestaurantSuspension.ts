import { MigrationInterface, QueryRunner } from 'typeorm';
import { SUSPENSION_DOWN_BLOCKED } from '../modules/restaurant-operations/restaurant-review/suspension-rollback.js';

// Suspensión de restaurantes aprobados (panel del administrador, Sprint 4).
// - Agrega 'suspended' a approval_status: TypeORM compara los checks solo por
//   nombre, así que el check se borra y se vuelve a crear a mano.
// - La última suspensión (motivo, cuándo y quién) vive en el propio restaurante:
//   no hay tabla de auditoría. Reactivar la conserva como "última suspensión".
// - CHK_restaurants_suspension: un suspendido siempre tiene motivo, fecha y
//   administrador. Los demás estados no exigen nada (un reactivado conserva los
//   datos de su última suspensión).
//
// down: si quedan restaurantes suspendidos se detiene con un mensaje claro,
// antes de tocar nada, en vez de reactivarlos por su cuenta.
export class AddRestaurantSuspension1794700000000 implements MigrationInterface {
  name = 'AddRestaurantSuspension1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_approval_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_approval_status" CHECK ("approval_status" IN ('pending', 'approved', 'rejected', 'suspended'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "suspension_reason" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "suspended_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "suspended_by" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_suspension" CHECK ("approval_status" <> 'suspended' OR ("suspension_reason" IS NOT NULL AND "suspended_at" IS NOT NULL AND "suspended_by" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "FK_restaurants_suspended_by" FOREIGN KEY ("suspended_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS "count" FROM "restaurants" WHERE "approval_status" = 'suspended'`,
    )) as { count: number }[];
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) {
      throw new Error(SUSPENSION_DOWN_BLOCKED(count));
    }
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "FK_restaurants_suspended_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_suspension"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "suspended_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "suspended_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "suspension_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_approval_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_approval_status" CHECK ("approval_status" IN ('pending', 'approved', 'rejected'))`,
    );
  }
}
