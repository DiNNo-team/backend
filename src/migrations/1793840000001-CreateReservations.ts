import { MigrationInterface, QueryRunner } from 'typeorm';

// Microreservas (Sprint 3, CLAUDE.md §12.1 y §12.4). Escrita a mano: los checks
// y los índices llevan nombre explícito y guardan los valores de
// reservation.constants.ts (RESERVATION_STATUSES, RESERVATION_CODE_ALPHABET);
// 1793840000001-CreateReservations.spec.ts falla si se desalinean. Los tres
// índices únicos parciales (solo filas 'active') son la defensa final contra
// dos solicitudes que compiten por la misma mesa, comensal o código.
export class CreateReservations1793840000001 implements MigrationInterface {
  name = 'CreateReservations1793840000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" character varying(6) NOT NULL, "status" character varying(20) NOT NULL, "party_size" smallint NOT NULL, "diner_id" uuid NOT NULL, "restaurant_id" uuid NOT NULL, "table_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "cancelled_at" TIMESTAMP WITH TIME ZONE, "expired_at" TIMESTAMP WITH TIME ZONE, "checked_in_at" TIMESTAMP WITH TIME ZONE, "no_show" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_reservations_status" CHECK ("status" IN ('active', 'cancelled', 'expired', 'completed')), CONSTRAINT "CHK_reservations_party_size" CHECK ("party_size" BETWEEN 1 AND 20), CONSTRAINT "CHK_reservations_code" CHECK ("code" ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'), CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reservations_active_table" ON "reservations" ("table_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reservations_active_diner" ON "reservations" ("diner_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reservations_active_code" ON "reservations" ("code") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_restaurant_status_expires_at" ON "reservations" ("restaurant_id", "status", "expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reservations_diner_id_created_at" ON "reservations" ("diner_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "FK_e4039bcc900c0eeddb4bb857fef" FOREIGN KEY ("diner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "FK_ee6b00404309108652a2307c66c" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" ADD CONSTRAINT "FK_5027ce24b4bc5e090302b2f7754" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "FK_5027ce24b4bc5e090302b2f7754"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "FK_ee6b00404309108652a2307c66c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reservations" DROP CONSTRAINT "FK_e4039bcc900c0eeddb4bb857fef"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reservations_diner_id_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reservations_restaurant_status_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_reservations_active_code"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_reservations_active_diner"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_reservations_active_table"`,
    );
    await queryRunner.query(`DROP TABLE "reservations"`);
  }
}
