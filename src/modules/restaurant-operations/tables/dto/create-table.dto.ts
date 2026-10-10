import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { MaxCodePoints } from '../../shared/max-code-points.js';
import {
  IDENTIFIER_INVISIBLE_CHARACTERS,
  IDENTIFIER_REQUIRED,
  IDENTIFIER_TOO_LONG,
  TABLE_IDENTIFIER_MAX_LENGTH,
} from '../table-identifier.js';

// Control and format characters (Unicode category C: zero-width spaces,
// bidirectional marks…) would make "04" and "04\u200B" two different tables
// that look the same.
const NO_INVISIBLE_CHARACTERS = /^\P{C}*$/u;

export { TABLE_IDENTIFIER_MAX_LENGTH };
export const TABLE_CAPACITY_MIN = 1;
export const TABLE_CAPACITY_MAX = 20;

// User-facing texts follow the identity manual (12.4: "Identificador y
// Capacidad") and match the web word for word. One capacity message for 0, 21,
// 2.5 and text.
export const CAPACITY_RANGE = `La capacidad va de ${TABLE_CAPACITY_MIN} a ${TABLE_CAPACITY_MAX} personas.`;

// status, isActive and restaurantId are not here on purpose: a new table is
// always available and active, and the restaurant comes from the session.
export class CreateTableDto {
  @ApiProperty({
    description:
      'Identificador corto de la mesa: la interfaz lo muestra como "Mesa 04" (dos dígitos si es numérico). Se recortan los espacios de los extremos. Único por restaurante: "4", "04", "Mesa 4" y "mesa 4 " son la misma mesa, igual que "T1" y "t1".',
    example: '04',
    minLength: 1,
    maxLength: TABLE_IDENTIFIER_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: IDENTIFIER_REQUIRED })
  @IsNotEmpty({ message: IDENTIFIER_REQUIRED })
  // MaxCodePoints and Matches also fail on non-strings; there the only
  // useful message is IDENTIFIER_REQUIRED (the pipe drops the repeated one).
  // Counted in code points, like the varchar(50) column (10 fits well).
  @MaxCodePoints(TABLE_IDENTIFIER_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string' ? IDENTIFIER_TOO_LONG : IDENTIFIER_REQUIRED,
  })
  @Matches(NO_INVISIBLE_CHARACTERS, {
    message: ({ value }) =>
      typeof value === 'string'
        ? IDENTIFIER_INVISIBLE_CHARACTERS
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
