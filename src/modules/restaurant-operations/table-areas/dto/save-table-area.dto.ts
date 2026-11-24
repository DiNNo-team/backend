import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { MaxCodePoints } from '../../../../common/validation/max-code-points.js';
import { NoInvisibleCharacters } from '../../../../common/validation/no-invisible-characters.js';
import {
  AREA_NAME_INVISIBLE_CHARACTERS,
  AREA_NAME_MAX_LENGTH,
  AREA_NAME_REQUIRED,
  AREA_NAME_TOO_LONG,
} from '../table-area-rules.js';

// Create and rename take the same body: only the name.
export class SaveTableAreaDto {
  @ApiProperty({
    description:
      'Nombre de la zona, por ejemplo "Piso 1", "Terraza" o "Bar". Se recortan los espacios de los extremos. Único por restaurante sin importar mayúsculas.',
    example: 'Terraza',
    minLength: 1,
    maxLength: AREA_NAME_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: AREA_NAME_REQUIRED })
  @IsNotEmpty({ message: AREA_NAME_REQUIRED })
  @MaxCodePoints(AREA_NAME_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string' ? AREA_NAME_TOO_LONG : AREA_NAME_REQUIRED,
  })
  @NoInvisibleCharacters({
    message: ({ value }) =>
      typeof value === 'string'
        ? AREA_NAME_INVISIBLE_CHARACTERS
        : AREA_NAME_REQUIRED,
  })
  name: string;
}
