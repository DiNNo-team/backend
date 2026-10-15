import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { MaxCodePoints } from '../../../../common/validation/max-code-points.js';
import { NoInvisibleCharacters } from '../../../../common/validation/no-invisible-characters.js';

export const DISPLAY_NAME_MAX_LENGTH = 60;

const DISPLAY_NAME_REQUIRED = 'Escribe tu nombre.';
const DISPLAY_NAME_TOO_LONG = `Tu nombre es muy largo. Usa máximo ${DISPLAY_NAME_MAX_LENGTH} caracteres.`;
const DISPLAY_NAME_INVISIBLE_CHARACTERS =
  'Tu nombre no puede incluir caracteres invisibles ni saltos de línea.';

export class RegisterDinerDto {
  @ApiPropertyOptional({
    description:
      'Nombre para mostrar en la app. Se recortan los espacios de los extremos. Si no se envía, se usa el nombre de la cuenta de Google y, si no hay, la parte del correo antes de @.',
    example: 'Ana',
    minLength: 1,
    maxLength: DISPLAY_NAME_MAX_LENGTH,
  })
  // Only an absent field is skipped: null and "" are rejected.
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: DISPLAY_NAME_REQUIRED })
  @IsNotEmpty({ message: DISPLAY_NAME_REQUIRED })
  // Counted like the varchar(60) column (see MaxCodePoints).
  @MaxCodePoints(DISPLAY_NAME_MAX_LENGTH, {
    message: ({ value }) =>
      typeof value === 'string' ? DISPLAY_NAME_TOO_LONG : DISPLAY_NAME_REQUIRED,
  })
  @NoInvisibleCharacters({
    message: ({ value }) =>
      typeof value === 'string'
        ? DISPLAY_NAME_INVISIBLE_CHARACTERS
        : DISPLAY_NAME_REQUIRED,
  })
  displayName?: string;
}
