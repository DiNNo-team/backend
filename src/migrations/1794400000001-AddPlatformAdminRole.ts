import { MigrationInterface, QueryRunner } from 'typeorm';
import { PLATFORM_ADMIN_DOWN_BLOCKED } from '../modules/identity-access/roles/platform-admin-rollback.js';

// Rol platform_admin (administrador de DiNNo; solo por seed o SQL, nunca por
// registro). TypeORM compara los checks solo por nombre, así que cambiar
// UserRole exige borrar y volver a crear CHK_users_role a mano.
// 1794400000001-AddPlatformAdminRole.spec.ts falla si se separa de UserRole.
//
// down: vuelve a los dos roles del Sprint 2. Si quedan usuarios platform_admin
// no puede (el check los rechazaría): se detiene con un mensaje claro, antes de
// tocar nada, en vez de borrarlos o cambiarles el rol por su cuenta.
export class AddPlatformAdminRole1794400000001 implements MigrationInterface {
  name = 'AddPlatformAdminRole1794400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('restaurant_admin', 'diner', 'platform_admin'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS "count" FROM "users" WHERE "role" = 'platform_admin'`,
    )) as { count: number }[];
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) {
      throw new Error(PLATFORM_ADMIN_DOWN_BLOCKED(count));
    }
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('restaurant_admin', 'diner'))`,
    );
  }
}
