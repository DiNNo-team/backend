import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantProfile1791250327133 implements MigrationInterface {
  name = 'AddRestaurantProfile1791250327133';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "category" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD "address" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurants" ADD CONSTRAINT "CHK_restaurants_category" CHECK ("category" IS NULL OR "category" IN ('colombian', 'italian', 'mexican', 'asian', 'grill', 'fast_food', 'healthy', 'seafood', 'cafe', 'other'))`,
    );
    await queryRunner.query(
      `CREATE TABLE "restaurant_schedules" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "restaurant_id" uuid NOT NULL, "day_of_week" smallint NOT NULL, "is_open_24h" boolean NOT NULL DEFAULT false, "opens_at" TIME, "closes_at" TIME, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_restaurant_schedules_restaurant_id_day_of_week" UNIQUE ("restaurant_id", "day_of_week"), CONSTRAINT "CHK_restaurant_schedules_hours" CHECK (("is_open_24h" = true AND "opens_at" IS NULL AND "closes_at" IS NULL) OR ("is_open_24h" = false AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL AND "opens_at" <> "closes_at")), CONSTRAINT "CHK_restaurant_schedules_day_of_week" CHECK ("day_of_week" BETWEEN 1 AND 7), CONSTRAINT "PK_5c6c35f90e4136c1c9cc425a714" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "restaurant_schedules" ADD CONSTRAINT "FK_1824e762f72771ae28c2a178cd4" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurant_schedules" DROP CONSTRAINT "FK_1824e762f72771ae28c2a178cd4"`,
    );
    await queryRunner.query(`DROP TABLE "restaurant_schedules"`);
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "CHK_restaurants_category"`,
    );
    await queryRunner.query(`ALTER TABLE "restaurants" DROP COLUMN "address"`);
    await queryRunner.query(`ALTER TABLE "restaurants" DROP COLUMN "category"`);
  }
}
