import { ApiProperty } from '@nestjs/swagger';
import {
  TABLE_LOG_SOURCES,
  TABLE_LOG_STATUSES,
  type TableLogSource,
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
    type: String,
    nullable: true,
    example: 'admin@example.com',
    description:
      'Correo del restaurant_admin que hizo el cambio. null en dos casos: los cambios automáticos (source = system, la web muestra "Automático") y los de un comensal (source = reservation, la web muestra "Comensal"): su correo nunca se le muestra al restaurante.',
  })
  userEmail: string | null;

  @ApiProperty({
    enum: TABLE_LOG_SOURCES,
    example: 'manual',
    description:
      'Quién originó el cambio: manual = el restaurante a mano, reservation = una microreserva (crear, cancelar o check-in), system = automático (vencimiento de una reserva).',
  })
  source: TableLogSource;

  static fromRow(row: TableLogRow): TableLogResponseDto {
    return {
      id: row.id,
      tableId: row.tableId,
      tableIdentifier: row.tableIdentifier,
      previousStatus: row.previousStatus,
      newStatus: row.newStatus,
      changedAt: new Date(row.changedAt),
      userEmail: row.userEmail,
      source: row.source,
    };
  }
}
