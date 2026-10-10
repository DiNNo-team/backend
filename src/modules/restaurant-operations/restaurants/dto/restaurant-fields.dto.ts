import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { MaxCodePoints } from '../../shared/max-code-points.js';
import {
  RESTAURANT_CATEGORIES,
  type RestaurantCategory,
} from '../restaurant.entity.js';

export const RESTAURANT_NAME_MAX_LENGTH = 120;
export const RESTAURANT_ADDRESS_MAX_LENGTH = 255;

const NAME_REQUIRED = 'Escribe el nombre de tu restaurante.';
const CATEGORY_INVALID = 'Elige la categoría de tu restaurante de la lista.';
const ADDRESS_REQUIRED = 'Escribe la dirección de tu restaurante.';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Single source of the restaurant field rules, shared by registration
// (Santiago, PBI 3) and editing (Elizabeth, PBI 4): editing derives from this
// class with PartialType, so every field added here is editable with no other
// change. Each field is named like its Restaurant entity property. Opening
// hours are not here: they live in another table, so editing cannot copy them
// to the entity (see dto/register-restaurant.dto.ts).
export class RestaurantFieldsDto {
  @ApiProperty({
    description:
      'Nombre del restaurante. Se recortan los espacios de los extremos.',
    example: 'La Esquina de Ana',
    minLength: 1,
    maxLength: RESTAURANT_NAME_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString({ message: NAME_REQUIRED })
  @IsNotEmpty({ message: NAME_REQUIRED })
  // MaxCodePoints also fails on non-strings; there the only useful message
  // is NAME_REQUIRED (the pipe drops the repeated one). The limit is the
  // column size, varchar(120).
  @MaxCodePoints(RESTAURANT_NAME_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string'
        ? `El nombre del restaurante es muy largo. Usa máximo ${RESTAURANT_NAME_MAX_LENGTH} caracteres.`
        : NAME_REQUIRED,
  })
  name: string;

  @ApiProperty({
    description:
      'Categoría del restaurante. Textos en la interfaz: colombian = Colombiana, italian = Italiana, mexican = Mexicana, asian = Asiática, grill = Parrilla, fast_food = Comida rápida, healthy = Saludable, seafood = Mariscos, cafe = Cafetería, other = Otra.',
    enum: RESTAURANT_CATEGORIES,
    example: 'colombian',
  })
  @IsIn(RESTAURANT_CATEGORIES, { message: CATEGORY_INVALID })
  category: RestaurantCategory;

  @ApiProperty({
    description:
      'Dirección del restaurante. Se recortan los espacios de los extremos.',
    example: 'Calle 72 # 10-34, Bogotá',
    minLength: 1,
    maxLength: RESTAURANT_ADDRESS_MAX_LENGTH,
  })
  @Transform(trim)
  @IsString({ message: ADDRESS_REQUIRED })
  @IsNotEmpty({ message: ADDRESS_REQUIRED })
  // Column size: varchar(255).
  @MaxCodePoints(RESTAURANT_ADDRESS_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string'
        ? `La dirección es muy larga. Usa máximo ${RESTAURANT_ADDRESS_MAX_LENGTH} caracteres.`
        : ADDRESS_REQUIRED,
  })
  address: string;
}
