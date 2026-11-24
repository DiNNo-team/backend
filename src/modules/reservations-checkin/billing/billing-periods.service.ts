import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { restaurantNotFound } from '../../restaurant-operations/index.js';
import { Clock } from '../../search-availability/index.js';
import { PlatformBillingReader } from '../platform/platform-billing.reader.js';
import { billingConflict } from './billing-errors.js';
import type { BillingMonth } from './billing-month.js';
import { BillingStatementService } from './billing-statement.service.js';

// Marcar un mes de un restaurante como cobrado o deshacerlo (panel del
// administrador, Sprint 4). No hay pasarela de pagos: lo marca a mano el
// administrador. Cada acción es UNA sentencia condicional, así dos
// administradores a la vez no rompen el estado: uno gana y el otro recibe 409.
@Injectable()
export class BillingPeriodsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reader: PlatformBillingReader,
    private readonly billing: BillingStatementService,
    private readonly clock: Clock,
  ) {}

  // Orden de las reglas: 404 (no existe) → 409 PERIOD_NOT_CLOSED → 409
  // NOTHING_TO_BILL → 409 PERIOD_ALREADY_PAID.
  //
  // El snapshot es SUM(fee_cop) del mes. Los check-ins de un mes cerrado ya no
  // cambian (checked_in_at es la hora del check-in), así que calcularlo antes de
  // la sentencia no deja una ventana. El UPSERT con WHERE status = 'pending' es
  // la defensa ante la concurrencia: con dos marcas a la vez, la segunda espera
  // el índice único, ve la fila ya 'paid', no actualiza nada y no devuelve fila.
  async markPaid(
    adminId: string,
    restaurantId: string,
    month: BillingMonth,
  ): Promise<void> {
    await this.requireRestaurant(restaurantId);
    if (!month.closed) {
      throw billingConflict('PERIOD_NOT_CLOSED');
    }
    const totals = await this.billing.totals(restaurantId, month.period);
    if (totals.checkIns === 0) {
      throw billingConflict('NOTHING_TO_BILL');
    }
    const rows = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO "billing_periods" ("restaurant_id", "period_month", "status", "amount_cop_snapshot", "check_ins_snapshot", "marked_paid_at", "marked_paid_by")
       VALUES ($1, $2::date, 'paid', $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT "UQ_billing_periods_restaurant_id_period_month" DO UPDATE
         SET "status" = 'paid',
             "amount_cop_snapshot" = EXCLUDED."amount_cop_snapshot",
             "check_ins_snapshot" = EXCLUDED."check_ins_snapshot",
             "marked_paid_at" = EXCLUDED."marked_paid_at",
             "marked_paid_by" = EXCLUDED."marked_paid_by",
             "updated_at" = now()
         WHERE "billing_periods"."status" = 'pending'
       RETURNING "id"`,
      [
        restaurantId,
        month.firstDay,
        totals.amountCop,
        totals.checkIns,
        this.clock.now(),
        adminId,
      ],
    );
    if (rows.length === 0) {
      throw billingConflict('PERIOD_ALREADY_PAID');
    }
  }

  // Deshace una marca equivocada: vuelve a pending y limpia el snapshot y los
  // datos del pago. Solo desde paid (409 PERIOD_NOT_PAID si no lo está).
  async markPending(restaurantId: string, month: BillingMonth): Promise<void> {
    await this.requireRestaurant(restaurantId);
    // TypeORM answers a raw UPDATE with [rows, affected].
    const [, affected] = await this.dataSource.query<[unknown[], number]>(
      `UPDATE "billing_periods"
       SET "status" = 'pending', "amount_cop_snapshot" = NULL, "check_ins_snapshot" = NULL,
           "marked_paid_at" = NULL, "marked_paid_by" = NULL, "updated_at" = now()
       WHERE "restaurant_id" = $1 AND "period_month" = $2::date AND "status" = 'paid'`,
      [restaurantId, month.firstDay],
    );
    if (affected === 0) {
      throw billingConflict('PERIOD_NOT_PAID');
    }
  }

  private async requireRestaurant(restaurantId: string): Promise<void> {
    if ((await this.reader.restaurantHeader(restaurantId)) === null) {
      throw restaurantNotFound();
    }
  }
}
