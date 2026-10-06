import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TABLE_IDENTIFIER_MAX_LENGTH = 50;
export const TABLE_CAPACITY_MIN = 1;
export const TABLE_CAPACITY_MAX = 20;

// User-facing text follows the identity manual, section 14: the user sees
// "nombre de la mesa", never "identificador" (identifier stays in the code).
const IDENTIFIER_REQUIRED =
  'Escribe un nombre para la mesa, por ejemplo "Mesa 4".';
// "cuántas personas" already implies a whole number: one message for 0, 21, 2.5 and text.
export const CAPACITY_RANGE = `Escribe cuántas personas caben en la mesa, entre ${TABLE_CAPACITY_MIN} y ${TABLE_CAPACITY_MAX}.`;

// status, isActive and restaurantId are not here on purpose: a new table is
// always available and active, and the restaurant comes from the session.
export class CreateTableDto {
  @ApiProperty({
    description:
      'Nombre de la mesa (en la interfaz se llama "nombre", no "identificador"). Se recortan los espacios de los extremos. Único por restaurante sin importar mayúsculas ni espacios ("Mesa 4" y "mesa 4 " son la misma mesa).',
    example: 'Mesa 4',
    minLength: 1,
    maxLength: TABLE_IDENTIFIER_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: IDENTIFIER_REQUIRED })
  @IsNotEmpty({ message: IDENTIFIER_REQUIRED })
  // MaxLength also fails on non-strings; there the only useful message is
  // IDENTIFIER_REQUIRED (the pipe drops the repeated one).
  @MaxLength(TABLE_IDENTIFIER_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string'
        ? `El nombre de la mesa es muy largo. Usa máximo ${TABLE_IDENTIFIER_MAX_LENGTH} caracteres.`
        : IDENTIFIER_REQUIRED,
  })
  identifier: string;

  @ApiProperty({
    description: 'Número de personas que caben en la mesa.',
    example: 4,
    type: 'integer',
    minimum: TABLE_CAPACITY_MIN,
    maximum: TABLE_CAPACITY_MAX,
  })
  @IsInt({ message: CAPACITY_RANGE })
  @Min(TABLE_CAPACITY_MIN, { message: CAPACITY_RANGE })
  @Max(TABLE_CAPACITY_MAX, { message: CAPACITY_RANGE })
  capacity: number;
}
