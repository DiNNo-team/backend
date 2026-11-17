import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const BILLING_PERIOD_STATUSES = ['pending', 'paid'] as const;
export type BillingPeriodStatus = (typeof BILLING_PERIOD_STATUSES)[number];

// Estado de cobro de un restaurante en un mes (panel del administrador, Sprint
// 4). Lo marca a mano el administrador: no hay pasarela de pagos. Sin fila = mes
// pendiente. El snapshot guarda lo que se cobró al marcarlo; el monto del mes
// siempre se recalcula de check_ins.fee_cop, y si no coincide se avisa
// (amountMismatch), nunca se corrige en silencio. Migración
// 1794700000001-CreateBillingPeriods; las checks se mantienen a mano allí.
@Entity({ name: 'billing_periods' })
@Unique('UQ_billing_periods_restaurant_id_period_month', [
  'restaurantId',
  'periodMonth',
])
@Check('CHK_billing_periods_status', `"status" IN ('pending', 'paid')`)
@Check(
  'CHK_billing_periods_month_first_day',
  `EXTRACT(DAY FROM "period_month") = 1`,
)
@Check(
  'CHK_billing_periods_snapshots',
  `("amount_cop_snapshot" IS NULL OR "amount_cop_snapshot" >= 0) AND ("check_ins_snapshot" IS NULL OR "check_ins_snapshot" >= 0)`,
)
@Check(
  'CHK_billing_periods_paid_fields',
  `("status" = 'paid' AND "amount_cop_snapshot" IS NOT NULL AND "check_ins_snapshot" IS NOT NULL AND "marked_paid_at" IS NOT NULL AND "marked_paid_by" IS NOT NULL) OR ("status" = 'pending' AND "amount_cop_snapshot" IS NULL AND "check_ins_snapshot" IS NULL AND "marked_paid_at" IS NULL AND "marked_paid_by" IS NULL)`,
)
export class BillingPeriod {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_billing_periods_id',
  })
  id: string;

  @Column({ name: 'restaurant_id', type: 'uuid' })
  @ForeignKey('Restaurant', { name: 'FK_billing_periods_restaurant_id' })
  restaurantId: string;

  // Siempre el día 1 del mes (AAAA-MM-01); pg devuelve date como texto.
  @Column({ name: 'period_month', type: 'date' })
  periodMonth: string;

  @Column({ type: 'varchar', length: 10 })
  status: BillingPeriodStatus;

  @Column({ name: 'amount_cop_snapshot', type: 'integer', nullable: true })
  amountCopSnapshot: number | null;

  @Column({ name: 'check_ins_snapshot', type: 'integer', nullable: true })
  checkInsSnapshot: number | null;

  @Column({ name: 'marked_paid_at', type: 'timestamptz', nullable: true })
  markedPaidAt: Date | null;

  @Column({ name: 'marked_paid_by', type: 'uuid', nullable: true })
  @ForeignKey('User', { name: 'FK_billing_periods_marked_paid_by' })
  markedPaidBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
