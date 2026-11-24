import { MigrationInterface, QueryRunner } from 'typeorm';

// Índice para el resumen del restaurante (CLAUDE.md §11, "Resumen y KPIs"):
// cuenta las reservas de un restaurante con created_at dentro de un periodo. El
// índice que ya existe, IDX_reservations_restaurant_status_expires_at, no sirve
// para un rango sobre created_at (status va en medio y la columna es otra).
// Escrita a mano; depende de CreateReservations.
export class AddReservationsRestaurantCreatedAtIndex1794600000002 implements MigrationInterface {
  name = 'AddReservationsRestaurantCreatedAtIndex1794600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_restaurant_id_created_at" ON "reservations" ("restaurant_id", "created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reservations_restaurant_id_created_at"`,
    );
  }
}
