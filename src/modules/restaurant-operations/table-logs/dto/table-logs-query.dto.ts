import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { TABLE_ID_INVALID } from '../../tables/tables.controller.js';

// Query of GET /v1/table-logs. There is no restaurant parameter on purpose:
// the restaurant always comes from the session, and the global ValidationPipe
// rejects any other query parameter (restaurantId included) with 400.
export class TableLogsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Solo los cambios de esta mesa. Si la mesa no existe o es de otro restaurante, la respuesta es una lista vacía.',
    example: '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f',
  })
  @IsOptional()
  @IsUUID('all', { message: TABLE_ID_INVALID })
  tableId?: string;
}
