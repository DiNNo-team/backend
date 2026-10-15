import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { MaxCodePoints } from '../../../../common/validation/max-code-points.js';
import { NoInvisibleCharacters } from '../../../../common/validation/no-invisible-characters.js';
import { RESTAURANT_ADDRESS_MAX_LENGTH } from '../../restaurants/dto/restaurant-fields.dto.js';

export const ADDRESS_MIN_LENGTH = 3;

export const GEOCODE_QUERY_MESSAGES = {
  ADDRESS_REQUIRED: 'Escribe la dirección que quieres ubicar.',
  ADDRESS_TOO_SHORT: `La dirección es muy corta. Escribe al menos ${ADDRESS_MIN_LENGTH} caracteres.`,
  ADDRESS_TOO_LONG: `La dirección es muy larga. Usa máximo ${RESTAURANT_ADDRESS_MAX_LENGTH} caracteres.`,
  ADDRESS_INVISIBLE:
    'La dirección no puede incluir caracteres invisibles ni saltos de línea.',
} as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Query of GET /v1/geocode. Same maximum as the restaurant address, because
// the web geocodes the text it is about to save. A repeated ?address= arrives
// as a list and is rejected like a missing one.
export class GeocodeQueryDto {
  @ApiProperty({
    description:
      'Dirección en Bogotá, tal como la escribe el usuario. Se recortan los espacios de los extremos.',
    example: 'Cra. 11 #72-30',
    minLength: ADDRESS_MIN_LENGTH,
    maxLength: RESTAURANT_ADDRESS_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString({ message: GEOCODE_QUERY_MESSAGES.ADDRESS_REQUIRED })
  @IsNotEmpty({ message: GEOCODE_QUERY_MESSAGES.ADDRESS_REQUIRED })
  // The rules below also fail on non-strings and on ""; there the only
  // useful message is ADDRESS_REQUIRED, already given above.
  @MinLength(ADDRESS_MIN_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string' && value !== ''
        ? GEOCODE_QUERY_MESSAGES.ADDRESS_TOO_SHORT
        : GEOCODE_QUERY_MESSAGES.ADDRESS_REQUIRED,
  })
  @MaxCodePoints(RESTAURANT_ADDRESS_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string'
        ? GEOCODE_QUERY_MESSAGES.ADDRESS_TOO_LONG
        : GEOCODE_QUERY_MESSAGES.ADDRESS_REQUIRED,
  })
  @NoInvisibleCharacters({
    message: ({ value }) =>
      typeof value === 'string'
        ? GEOCODE_QUERY_MESSAGES.ADDRESS_INVISIBLE
        : GEOCODE_QUERY_MESSAGES.ADDRESS_REQUIRED,
  })
  address: string;
}

export class GeocodeResponseDto {
  @ApiProperty({ description: 'Latitud con 6 decimales.', example: 4.655671 })
  latitude: number;

  @ApiProperty({
    description: 'Longitud con 6 decimales.',
    example: -74.057006,
  })
  longitude: number;

  @ApiProperty({
    description:
      'Dirección tal como la reconoce el proveedor de mapas (Google).',
    example: 'Cra. 11 #72-30, Bogotá, Colombia',
  })
  formattedAddress: string;
}
