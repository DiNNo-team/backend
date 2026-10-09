import { ApiProperty } from '@nestjs/swagger';
import {
  TABLE_LOG_STATUSES,
  type TableLogStatus,
} from '../../tables/table-status-log.js';
import type { TableLogRow } from '../table-logs.service.js';

const STATUS_DESCRIPTION =
  'available = Disponible, reserved = Reservada, occupied = Ocupada, inactive = Inactiva (desactivada). inactive solo existe en la bitácora.';

// One row of the table log screen (/bitacora): who changed which table, from
// what to what, and when.
export class TableLogResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  })
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f',
  })
  tableId: string;

  @ApiProperty({
    example: '04',
    description:
      'Identificador actual de la mesa, como lo escribió el restaurante. La web lo muestra como "Mesa 04".',
  })
  tableIdentifier: string;

  @ApiProperty({
    enum: TABLE_LOG_STATUSES,
    example: 'available',
    description: STATUS_DESCRIPTION,
  })
  previousStatus: TableLogStatus;

  @ApiProperty({
    enum: TABLE_LOG_STATUSES,
    example: 'occupied',
    description: STATUS_DESCRIPTION,
  })
  newStatus: TableLogStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-08T19:30:00.000Z',
    description: 'Cuándo se hizo el cambio.',
  })
  changedAt: Date;

  @ApiProperty({
    example: 'admin@casa72.co',
    description:
      'Correo del usuario que hizo el cambio (users no tiene nombre).',
  })
  userEmail: string;

  static fromRow(row: TableLogRow): TableLogResponseDto {
    return {
      id: row.id,
      tableId: row.tableId,
      tableIdentifier: row.tableIdentifier,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      changedAt: new Date(row.changedAt),
      userEmail: row.userEmail,
    };
  }
}
