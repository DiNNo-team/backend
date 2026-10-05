import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const RESTAURANT_NAME_MAX_LENGTH = 120;

const NAME_REQUIRED = 'Escribe el nombre de tu restaurante.';

// Single source of the restaurant field rules, shared by registration
// (Santiago, PBI 3) and editing (Elizabeth, PBI 4): editing derives from this
// class with PartialType, so every field added here is editable with no other
// change. Santiago adds category, address and opening hours here, each named
// like its Restaurant entity property, with Spanish messages that say how to
// fix the value.
export class RestaurantFieldsDto {
  @ApiProperty({
    description:
      'Nombre del restaurante. Se recortan los espacios de los extremos.',
    example: 'La Esquina de Ana',
    minLength: 1,
    maxLength: RESTAURANT_NAME_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: NAME_REQUIRED })
  @IsNotEmpty({ message: NAME_REQUIRED })
  // MaxLength also fails on non-strings; there the only useful message is
  // NAME_REQUIRED (the pipe drops the repeated one).
  @MaxLength(RESTAURANT_NAME_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string'
        ? `El nombre del restaurante es muy largo. Usa máximo ${RESTAURANT_NAME_MAX_LENGTH} caracteres.`
        : NAME_REQUIRED,
  })
  name: string;
}
