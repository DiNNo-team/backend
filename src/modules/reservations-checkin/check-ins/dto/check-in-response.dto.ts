import { ApiProperty } from '@nestjs/swagger';

// Respuesta del check-in válido (§12.8).
export class CheckInResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  reservationId: string;

  @ApiProperty({
    example: '04',
    description:
      'Identificador de la mesa; la web lo muestra como "Mesa 04" en el mensaje de confirmación.',
  })
  tableIdentifier: string;

  @ApiProperty({ example: 2, description: 'Personas de la reserva.' })
  partySize: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ana',
    description:
      'Nombre del comensal, nunca un fragmento de su correo. Con null, la web muestra "Comensal".',
  })
  dinerName: string | null;

  @ApiProperty({
    example: '2026-11-05T17:35:00.000Z',
    description: 'Fecha ISO 8601 en UTC.',
  })
  checkedInAt: string;
}
