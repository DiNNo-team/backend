import { ApiProperty } from '@nestjs/swagger';
import {
  TABLE_STATUSES,
  type Table,
  type TableStatus,
} from '../table.entity.js';

export class TableResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f',
  })
  id: string;

  @ApiProperty({ example: 'Mesa 4' })
  identifier: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 20, example: 4 })
  capacity: number;

  @ApiProperty({
    enum: TABLE_STATUSES,
    example: 'available',
    description:
      'available = Disponible, reserved = Reservada, occupied = Ocupada. Una mesa nueva siempre es available.',
  })
  status: TableStatus;

  @ApiProperty({
    example: true,
    description:
      'false = mesa Inactiva (desactivada). No es un estado: va aparte de status. Una mesa nueva siempre es true.',
  })
  isActive: boolean;

  static fromEntity(table: Table): TableResponseDto {
    return {
      id: table.id,
      identifier: table.identifier,
      capacity: table.capacity,
      status: table.status,
      isActive: table.isActive,
    };
  }
}
