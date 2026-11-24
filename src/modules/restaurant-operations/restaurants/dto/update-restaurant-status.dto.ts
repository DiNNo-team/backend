import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export const IS_OPEN_INVALID =
  'Elige si el restaurante está Abierto o Cerrado.';

export class UpdateRestaurantStatusDto {
  @ApiProperty({
    description: 'true = Abierto, false = Cerrado.',
    example: false,
  })
  // No implicit conversion: "true" (text) is rejected, like a missing field.
  @IsBoolean({ message: IS_OPEN_INVALID })
  isOpen: boolean;
}
