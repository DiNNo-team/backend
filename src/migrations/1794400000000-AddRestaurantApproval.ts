import { MigrationInterface, QueryRunner } from 'typeorm';

// Aprobación de restaurantes (CLAUDE.md §11, "Aprobación de restaurantes").
// Escrita a mano: el check y la FK llevan nombre propio.
//
// approval_status: se agrega con DEFAULT 'approved' para que TODAS las filas
// existentes queden aprobadas en la misma sentencia (en PostgreSQL 11+ una
// columna con default constante no reescribe la tabla), y en seguida se quita
// el default. Así, sin default, todo INSERT que no fije el estado falla por NOT
// NULL: ningún restaurante nuevo nace aprobado por accidente; el código siempre
// lo fija (signup 'pending', registro de un usuario habilitado y seed
// 'approved'). 1794400000000-AddRestaurantApproval.spec.ts fija los valores.
export class AddRestaurantApproval1794400000000 implements MigrationInterface {
  name = 'AddRestaurantApproval1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "approval_status" character varying(20) NOT NULL DEFAULT 'approved'`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ALTER COLUMN "approval_status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_approval_status" CHECK ("approval_status" IN ('pending', 'approved', 'rejected'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "rejection_reason" character varying(300)`,
    );
    await queryRunner.query(`ALTER TABLE "restaurants" ADD "reviewed_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "reviewed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "contact_phone" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "FK_restaurants_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "FK_restaurants_reviewed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "contact_phone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "reviewed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "reviewed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "rejection_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_approval_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "approval_status"`,
    );
  }
}
