import {
  RESERVATION_CODE_ALPHABET,
  RESERVATION_CODE_LENGTH,
} from '../reservations/reservation.constants.js';

const CODE_FORMAT = new RegExp(
  `^[${RESERVATION_CODE_ALPHABET}]{${RESERVATION_CODE_LENGTH}}$`,
);

// El código como lo escribe el restaurante → como se guarda (§12.1): sin espacios
// y en mayúsculas. null si después de eso no tiene el formato de un código.
export function normalizeCheckInCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  return CODE_FORMAT.test(code) ? code : null;
}
