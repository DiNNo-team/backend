import { ApiProperty } from '@nestjs/swagger';
import type { TableArea } from '../table-area.entity.js';

export class TableAreaResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
  })
  id: string;

  @ApiProperty({ example: 'Terraza' })
  name: string;

  static fromEntity(area: TableArea): TableAreaResponseDto {
    return { id: area.id, name: area.name };
  }
}
