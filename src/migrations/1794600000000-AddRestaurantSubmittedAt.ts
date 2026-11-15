import { MigrationInterface, QueryRunner } from 'typeorm';

// Fecha de envío de la solicitud de aprobación (CLAUDE.md §11, "Administrador"):
// la lista de pendientes del administrador se ordena por ella, y el reenvío de un
// rechazado la actualiza. No se usa updated_at porque cambia con cualquier
// edición. Escrita a mano.
//
// Se agrega nullable, se llena con created_at (las solicitudes existentes se
// enviaron al crearse) y después queda NOT NULL con DEFAULT now(): un INSERT que
// no la fije (el registro de un usuario habilitado, el seed) toma la hora del
// INSERT, que es su fecha de envío. Depende de AddRestaurantApproval.
// 1794600000000-AddRestaurantSubmittedAt.spec.ts fija las sentencias.
export class AddRestaurantSubmittedAt1794600000000 implements MigrationInterface {
  name = 'AddRestaurantSubmittedAt1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "submitted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "restaurants" SET "submitted_at" = "created_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ALTER COLUMN "submitted_at" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ALTER COLUMN "submitted_at" SET DEFAULT now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "submitted_at"`,
    );
  }
}
