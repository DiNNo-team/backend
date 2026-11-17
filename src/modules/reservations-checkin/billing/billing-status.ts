import type { BillingMonth } from './billing-month.js';

// Estado de cobro de un mes de un restaurante: el del panel del administrador y
// el que ve el restaurante en su resumen (una sola regla). Un mes en curso es
// `in_progress`; un mes cerrado es `paid` solo si el administrador lo marcó, y
// si no, `pending`.
export const BILLING_STATUSES = ['in_progress', 'pending', 'paid'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export function billingStatus(
  month: Pick<BillingMonth, 'closed'>,
  row: { status: string } | null,
): BillingStatus {
  if (!month.closed) {
    return 'in_progress';
  }
  return row?.status === 'paid' ? 'paid' : 'pending';
}
