import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import {
  RESTAURANT_CATEGORIES,
  type RestaurantCategory,
} from '../../../restaurant-operations/index.js';
import {
  LatitudeField,
  LOCATION_MESSAGES,
  LongitudeField,
  toNumberOrNaN,
} from '../../location/location-fields.js';
import { ZONE_IDS, type ZoneId } from '../zones.js';

export const SEARCH_RADII_KM = [1, 2, 5, 10] as const;
export type SearchRadiusKm = (typeof SEARCH_RADII_KM)[number];
export const DEFAULT_SEARCH_RADIUS_KM: SearchRadiusKm = 2;
export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 20;

export const SEARCH_MESSAGES = {
  BOTH_ORIGINS: 'Busca por tu ubicación o por una zona, no por las dos.',
  NO_ORIGIN: 'Envía tu ubicación (lat y lng) o una zona para buscar.',
  ...LOCATION_MESSAGES,
  ZONE_UNKNOWN:
    'No conocemos esa zona. Usa una de las que da GET /v1/search/zones.',
  RADIUS_INVALID: 'El radio (radiusKm) debe ser 1, 2, 5 o 10.',
  CATEGORY_INVALID: `La categoría (category) debe ser una de estas: ${RESTAURANT_CATEGORIES.join(', ')}.`,
  PARTY_SIZE_INVALID: `El número de personas (partySize) debe ser un número entero entre ${MIN_PARTY_SIZE} y ${MAX_PARTY_SIZE}.`,
} as const;

interface SearchOrigin {
  lat?: unknown;
  lng?: unknown;
  zone?: unknown;
}

// The origin is the location (lat + lng) or a zone: exactly one of the two,
// and the location complete. null when the combination is valid.
export function searchOriginProblem(query: SearchOrigin): string | null {
  const hasLat = query.lat !== undefined;
  const hasLng = query.lng !== undefined;
  const hasZone = query.zone !== undefined;
  if (hasZone && (hasLat || hasLng)) {
    return SEARCH_MESSAGES.BOTH_ORIGINS;
  }
  if (!hasZone && !hasLat && !hasLng) {
    return SEARCH_MESSAGES.NO_ORIGIN;
  }
  if (hasLat !== hasLng) {
    return SEARCH_MESSAGES.INCOMPLETE_LOCATION;
  }
  return null;
}

// class-validator has no class-level rules, so the origin rule sits on zone.
// zone takes no @IsOptional on purpose: it would skip this rule when zone is
// missing, which is exactly when lat and lng have to be checked.
function ValidSearchOrigin() {
  return ValidateBy({
    name: 'validSearchOrigin',
    validator: {
      validate: (_value: unknown, args?: ValidationArguments) =>
        searchOriginProblem(args?.object as SearchOrigin) === null,
      defaultMessage: (args?: ValidationArguments) =>
        searchOriginProblem(args?.object as SearchOrigin) ?? '',
    },
  });
}

// IsIn, but a missing zone is valid (the origin rule decides).
function IsZoneIdOrMissing() {
  return ValidateBy(
    {
      name: 'isZoneIdOrMissing',
      validator: {
        validate: (value: unknown) =>
          value === undefined || ZONE_IDS.includes(value as ZoneId),
      },
    },
    { message: SEARCH_MESSAGES.ZONE_UNKNOWN },
  );
}

// Query of GET /v1/search/restaurants. Any other parameter is rejected with
// 400 by the global ValidationPipe.
export class SearchRestaurantsQueryDto {
  @ApiPropertyOptional({
    description:
      'Latitud de la ubicación del comensal. Va junto con lng y sin zone. Puede estar fuera de Bogotá: en ese caso no hay resultados.',
    minimum: -90,
    maximum: 90,
    example: 4.655671,
  })
  @LatitudeField()
  lat?: number;

  @ApiPropertyOptional({
    description: 'Longitud de la ubicación del comensal. Va junto con lat.',
    minimum: -180,
    maximum: 180,
    example: -74.057006,
  })
  @LongitudeField()
  lng?: number;

  @ApiPropertyOptional({
    description:
      'Zona de búsqueda (id de GET /v1/search/zones), en lugar de lat y lng. Se busca alrededor de su punto central.',
    enum: ZONE_IDS,
    example: 'calle-72',
  })
  @ValidSearchOrigin()
  @IsZoneIdOrMissing()
  zone?: ZoneId;

  @ApiPropertyOptional({
    description: 'Radio de búsqueda en km.',
    enum: SEARCH_RADII_KM,
    default: DEFAULT_SEARCH_RADIUS_KM,
    example: DEFAULT_SEARCH_RADIUS_KM,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(SEARCH_RADII_KM, { message: SEARCH_MESSAGES.RADIUS_INVALID })
  radiusKm: SearchRadiusKm = DEFAULT_SEARCH_RADIUS_KM;

  @ApiPropertyOptional({
    description:
      'Solo restaurantes de esta categoría (una por búsqueda). Un restaurante sin categoría no aparece cuando se filtra.',
    enum: RESTAURANT_CATEGORIES,
    example: 'colombian',
  })
  @IsOptional()
  @IsIn(RESTAURANT_CATEGORIES, { message: SEARCH_MESSAGES.CATEGORY_INVALID })
  category?: RestaurantCategory;

  @ApiPropertyOptional({
    description:
      'Número de personas. Solo aparecen los restaurantes con al menos una mesa libre y activa para todo el grupo.',
    type: 'integer',
    minimum: MIN_PARTY_SIZE,
    maximum: MAX_PARTY_SIZE,
    example: 4,
  })
  @IsOptional()
  @Transform(({ value }) => toNumberOrNaN(value))
  @IsInt({ message: SEARCH_MESSAGES.PARTY_SIZE_INVALID })
  @Min(MIN_PARTY_SIZE, { message: SEARCH_MESSAGES.PARTY_SIZE_INVALID })
  @Max(MAX_PARTY_SIZE, { message: SEARCH_MESSAGES.PARTY_SIZE_INVALID })
  partySize?: number;
}
