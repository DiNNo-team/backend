import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export const CHECK_IN_CODE_REQUIRED =
  'Escribe el código de la reserva que te muestra el comensal.';

// Solo se exige que sea texto. Un texto con otro formato no es un 400: responde
// el mismo 404 que un código que no existe (§12.6).
export class CheckInDto {
  @ApiProperty({
    description:
      'Código que muestra el comensal. Se aceptan minúsculas y espacios: el backend los normaliza.',
    example: 'K7M4QX',
  })
  @IsString({ message: CHECK_IN_CODE_REQUIRED })
  code: string;
}
