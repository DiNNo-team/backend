import { MigrationInterface, QueryRunner } from 'typeorm';

// Phones of the diners that receive the reservation notifications (Sprint 4,
// PBI 1.1): one row per FCM token. The token is unique (a phone belongs to one
// account at a time) and the rows go away with their user. Additive: no
// existing table changes. Hand-written, like the other migrations of the shared
// database.
export class CreatePushDevices1794500000000 implements MigrationInterface {
  name = 'CreatePushDevices1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "push_devices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token" character varying(4096) NOT NULL, "platform" character varying(10) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_push_devices_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_push_devices_platform" CHECK ("platform" IN ('android', 'ios')))`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_devices" ADD CONSTRAINT "FK_push_devices_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_push_devices_token" ON "push_devices" ("token")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_devices_user_id" ON "push_devices" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_push_devices_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_push_devices_token"`);
    await queryRunner.query(`DROP TABLE "push_devices"`);
  }
}
