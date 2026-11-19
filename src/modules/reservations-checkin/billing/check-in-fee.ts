// Única regla del cobro de un check-in: personas de la reserva × tarifa por
// comensal. El resultado es lo que se guarda en check_ins.fee_cop; los reportes
// y el cobro mensual solo suman ese valor, nunca lo recalculan.
export function checkInFeeCop(
  partySize: number,
  feePerGuestCop: number,
): number {
  return partySize * feePerGuestCop;
}
