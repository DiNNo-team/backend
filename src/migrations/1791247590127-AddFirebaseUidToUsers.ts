import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirebaseUidToUsers1791247590127 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "users" ADD "firebase_uid" character varying(128)`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_firebase_uid" UNIQUE ("firebase_uid")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_firebase_uid"`,
        );
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firebase_uid"`);
    }
}
