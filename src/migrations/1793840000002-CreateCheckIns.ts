import { MigrationInterface, QueryRunner } from 'typeorm';

// Check-ins (Sprint 3, CLAUDE.md §12.6): el evento facturable. La restricción
// única sobre reservation_id garantiza un check-in por reserva, así que nunca
// se cobra dos veces. Depende de CreateReservations.
export class CreateCheckIns1793840000002 implements MigrationInterface {
  name = 'CreateCheckIns1793840000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "check_ins" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "reservation_id" uuid NOT NULL, "restaurant_id" uuid NOT NULL, "checked_in_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_check_ins_reservation_id" UNIQUE ("reservation_id"), CONSTRAINT "PK_fac7f27bc829a454ad477c13f62" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "check_ins" ADD CONSTRAINT "FK_8991e2a070465881afab6d7de46" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "check_ins" ADD CONSTRAINT "FK_ccb00b32616a0a14f36f399d7f3" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "check_ins" DROP CONSTRAINT "FK_ccb00b32616a0a14f36f399d7f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "check_ins" DROP CONSTRAINT "FK_8991e2a070465881afab6d7de46"`,
    );
    await queryRunner.query(`DROP TABLE "check_ins"`);
  }
}
