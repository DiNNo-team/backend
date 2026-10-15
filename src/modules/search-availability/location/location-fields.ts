import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationArguments } from 'class-validator';

// The diner's location in a query (lat and lng), shared by the search and the
// public detail so both validate and word it the same way. Any coordinate is
// accepted, also outside Bogotá: there are just no restaurants there.
export const LOCATION_MESSAGES = {
  LAT_INVALID: 'La latitud (lat) debe ser un número entre -90 y 90.',
  LNG_INVALID: 'La longitud (lng) debe ser un número entre -180 y 180.',
  INCOMPLETE_LOCATION: 'Envía lat y lng juntas.',
} as const;

// Plain decimal notation only: optional minus, digits, optional fraction.
const DECIMAL_NUMBER = /^-?\d+(\.\d+)?$/;

// Query text to number. Only plain decimals are numbers: anything else
// (empty or blank, "0x10", "1e1", "Infinity", "+5", a repeated parameter)
// becomes NaN, which the validators reject with 400. Number() alone would
// turn "" into 0 and "0x10" into 16.
export function toNumberOrNaN(value: unknown): number {
  if (typeof value !== 'string') {
    return NaN;
  }
  const text = value.trim();
  return DECIMAL_NUMBER.test(text) ? Number(text) : NaN;
}

// A missing coordinate is valid here (the pair rule decides); a present one
// must be a number in range. One validator, so one message per field. No
// @IsOptional on purpose: it would also skip the pair rule.
function CoordinateOrMissing(name: string, limit: number, message: string) {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown) =>
          value === undefined ||
          (typeof value === 'number' &&
            Number.isFinite(value) &&
            Math.abs(value) <= limit),
      },
    },
    { message },
  );
}

export function LatitudeField() {
  return applyDecorators(
    Transform(({ value }) => toNumberOrNaN(value)),
    CoordinateOrMissing(
      'isLatitudeOrMissing',
      90,
      LOCATION_MESSAGES.LAT_INVALID,
    ),
  );
}

export function LongitudeField() {
  return applyDecorators(
    Transform(({ value }) => toNumberOrNaN(value)),
    CoordinateOrMissing(
      'isLongitudeOrMissing',
      180,
      LOCATION_MESSAGES.LNG_INVALID,
    ),
  );
}

interface LocationQuery {
  lat?: unknown;
  lng?: unknown;
}

// lat and lng together or neither. Put it on a field without @IsOptional
// (LatitudeField has none), so it also runs when lat is the one missing.
export function LocationPair() {
  return ValidateBy(
    {
      name: 'locationPair',
      validator: {
        validate: (_value: unknown, args?: ValidationArguments) => {
          const query = args?.object as LocationQuery;
          return (query.lat === undefined) === (query.lng === undefined);
        },
      },
    },
    { message: LOCATION_MESSAGES.INCOMPLETE_LOCATION },
  );
}
