import { ApiProperty } from '@nestjs/swagger';
import {
  TABLE_STATUSES,
  type Table,
  type TableStatus,
} from '../table.entity.js';
import {
  PLAN_COLUMNS,
  PLAN_ROWS,
  TABLE_SHAPES,
  type TableShape,
} from '../table-plan.js';

export class TableResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f2b8c1e-5d4a-4e7b-9c6f-1a2b3c4d5e6f',
  })
  id: string;

  @ApiProperty({ example: '04' })
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

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: PLAN_COLUMNS - 1,
    example: 4,
    description:
      'Columna de la esquina superior izquierda de la mesa en el plano (PUT /v1/tables/plan). null = la mesa no está ubicada; planX y planY son null juntos.',
  })
  planX: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: PLAN_ROWS - 1,
    example: 2,
    description:
      'Fila de la esquina superior izquierda de la mesa en el plano. null = la mesa no está ubicada.',
  })
  planY: number | null;

  @ApiProperty({
    enum: TABLE_SHAPES,
    nullable: true,
    example: null,
    description:
      'Forma en el plano: square = cuadrada, round = redonda, rect = rectangular. null = rectangular según la capacidad.',
  })
  planShape: TableShape | null;

  static fromEntity(table: Table): TableResponseDto {
    return {
      id: table.id,
      identifier: table.identifier,
      capacity: table.capacity,
      status: table.status,
      isActive: table.isActive,
      // A just-created table comes back from save() without these columns: it
      // is not on the plan yet.
      planX: table.planX ?? null,
      planY: table.planY ?? null,
      planShape: table.planShape ?? null,
    };
  }
}
