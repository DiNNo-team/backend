import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches, ValidateIf } from 'class-validator';

// Separators people type in a phone: spaces, hyphens, dots and parentheses.
const SEPARATORS = /[\s\-.()]/g;

// A Colombian phone, landline or mobile, with or without the country code:
// 7 to 15 digits once the separators are removed, with an optional leading +.
// Fits restaurants.contact_phone, varchar(20).
export const CONTACT_PHONE_PATTERN = /^\+?\d{7,15}$/;

export const CONTACT_PHONE_INVALID =
  'Escribe un teléfono de contacto válido: de 7 a 15 dígitos, por ejemplo 300 123 4567 o +57 601 234 5678.';

// "+57 (300) 123-4567" → "+573001234567". Anything that is not text is left
// as is, so the validation rejects it.
export function normalizeContactPhone(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(SEPARATORS, '') : value;
}

// The contact phone of a restaurant, normalized before it is validated and
// saved. required: false lets the field be left out (undefined), never null.
export function ContactPhoneField({ required }: { required: boolean }) {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => normalizeContactPhone(value)),
    ...(required
      ? []
      : [
          ValidateIf(
            (dto: { contactPhone?: unknown }) => dto.contactPhone !== undefined,
          ),
        ]),
    Matches(CONTACT_PHONE_PATTERN, { message: CONTACT_PHONE_INVALID }),
  );
}
