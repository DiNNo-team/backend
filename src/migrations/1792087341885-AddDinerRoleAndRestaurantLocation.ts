import { MigrationInterface, QueryRunner } from 'typeorm';

// Sprint 2: restaurant coordinates, the diner's display name and the two
// account roles. Hand-written: the checks are named by hand and the
// restriction to Bogotá lives in the API, not here. CHK_users_role holds the
// values of UserRole; 1792087341885-AddDinerRoleAndRestaurantLocation.spec.ts
// fails if they drift.
export class AddDinerRoleAndRestaurantLocation1792087341885 implements MigrationInterface {
  name = 'AddDinerRoleAndRestaurantLocation1792087341885';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "latitude" numeric(9,6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "longitude" numeric(9,6)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_location_pair" CHECK (("latitude" IS NULL AND "longitude" IS NULL) OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_latitude" CHECK ("latitude" BETWEEN -90 AND 90)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_longitude" CHECK ("longitude" BETWEEN -180 AND 180)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "display_name" character varying(60)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('restaurant_admin', 'diner'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_normalized" CHECK ("email" = lower(trim("email")))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_email_normalized"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "display_name"`);
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_longitude"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_latitude"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_location_pair"`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP COLUMN "longitude"`,
    );
    await queryRunner.query(`ALTER TABLE "restaurants" DROP COLUMN "latitude"`);
  }
}
