import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import {
  BOGOTA_BOUNDS,
  roundCoordinate,
} from '../../shared/bogota-location.js';

export const RESTAURANT_LOCATION_MESSAGES = {
  LATITUDE_INVALID: `Ubica el restaurante dentro de Bogotá: la latitud debe ser un número entre ${BOGOTA_BOUNDS.minLatitude} y ${BOGOTA_BOUNDS.maxLatitude}.`,
  LONGITUDE_INVALID: `Ubica el restaurante dentro de Bogotá: la longitud debe ser un número entre ${BOGOTA_BOUNDS.minLongitude} y ${BOGOTA_BOUNDS.maxLongitude}.`,
  INCOMPLETE_LOCATION:
    'Envía la latitud y la longitud juntas, o ninguna de las dos.',
} as const;

type CoordinateName = 'latitude' | 'longitude';

// Any number of decimals is accepted (the web map sends many) and rounded to
// the 6 the column keeps, so the response is what the database stores.
// Anything else passes untouched and the validator rejects it.
const roundIfNumber = ({ value }: { value: unknown }) =>
  typeof value === 'number' && Number.isFinite(value)
    ? roundCoordinate(value)
    : value;

function inRange(name: CoordinateName, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  return name === 'latitude'
    ? value >= BOGOTA_BOUNDS.minLatitude && value <= BOGOTA_BOUNDS.maxLatitude
    : value >= BOGOTA_BOUNDS.minLongitude &&
        value <= BOGOTA_BOUNDS.maxLongitude;
}

// Restaurant coordinate in a body, shared by registration and editing through
// RestaurantFieldsDto. Optional, but only an absent value is skipped: null is
// validated and rejected, so the location can never be erased. The pair rule
// sits on both fields because an absent field skips all its validators.
export function RestaurantCoordinateField(
  name: CoordinateName,
): PropertyDecorator {
  const other: CoordinateName = name === 'latitude' ? 'longitude' : 'latitude';
  return applyDecorators(
    Transform(roundIfNumber),
    ValidateIf((_, value) => value !== undefined),
    ValidateBy(
      {
        name: `${name}InBogota`,
        validator: { validate: (value: unknown) => inRange(name, value) },
      },
      {
        message:
          name === 'latitude'
            ? RESTAURANT_LOCATION_MESSAGES.LATITUDE_INVALID
            : RESTAURANT_LOCATION_MESSAGES.LONGITUDE_INVALID,
      },
    ),
    ValidateBy(
      {
        name: 'locationPair',
        validator: {
          validate: (_value: unknown, args?: ValidationArguments) => {
            const body = args?.object as
              Partial<Record<CoordinateName, unknown>> | undefined;
            return body?.[other] !== undefined;
          },
        },
      },
      { message: RESTAURANT_LOCATION_MESSAGES.INCOMPLETE_LOCATION },
    ),
  );
}
