import { MigrationInterface, QueryRunner } from 'typeorm';

// Estado de cobro mensual por restaurante (panel del administrador, Sprint 4).
// Una fila por restaurante y mes (period_month, siempre el día 1). Sin fila =
// mes pendiente: la fila solo nace cuando el administrador lo marca cobrado.
// - CHK_billing_periods_paid_fields: un mes 'paid' guarda el snapshot (monto y
//   check-ins) y quién y cuándo lo marcó; uno 'pending' no guarda nada de eso
//   (mark-pending lo limpia).
// - Sin valor por defecto en status: el código siempre lo fija.
// Aditiva: no cambia ninguna tabla existente.
export class CreateBillingPeriods1794700000001 implements MigrationInterface {
  name = 'CreateBillingPeriods1794700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "billing_periods" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "restaurant_id" uuid NOT NULL, "period_month" date NOT NULL, "status" character varying(10) NOT NULL, "amount_cop_snapshot" integer, "check_ins_snapshot" integer, "marked_paid_at" TIMESTAMP WITH TIME ZONE, "marked_paid_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_billing_periods_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_billing_periods_restaurant_id_period_month" UNIQUE ("restaurant_id", "period_month"), CONSTRAINT "CHK_billing_periods_status" CHECK ("status" IN ('pending', 'paid')), CONSTRAINT "CHK_billing_periods_month_first_day" CHECK (EXTRACT(DAY FROM "period_month") = 1), CONSTRAINT "CHK_billing_periods_snapshots" CHECK (("amount_cop_snapshot" IS NULL OR "amount_cop_snapshot" >= 0) AND ("check_ins_snapshot" IS NULL OR "check_ins_snapshot" >= 0)), CONSTRAINT "CHK_billing_periods_paid_fields" CHECK (("status" = 'paid' AND "amount_cop_snapshot" IS NOT NULL AND "check_ins_snapshot" IS NOT NULL AND "marked_paid_at" IS NOT NULL AND "marked_paid_by" IS NOT NULL) OR ("status" = 'pending' AND "amount_cop_snapshot" IS NULL AND "check_ins_snapshot" IS NULL AND "marked_paid_at" IS NULL AND "marked_paid_by" IS NULL)))`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_periods" ADD CONSTRAINT "FK_billing_periods_restaurant_id" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "billing_periods" ADD CONSTRAINT "FK_billing_periods_marked_paid_by" FOREIGN KEY ("marked_paid_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_periods"`);
  }
}
