import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TABLE_ID_INVALID } from '../../shared/table-id-invalid.js';
import {
  PLAN_COLUMNS,
  PLAN_ROWS,
  TABLE_SHAPES,
  type TableShape,
} from '../table-plan.js';

// The grid fits at most 6 × 15 of the smallest tables (3 × 2 cells).
export const PLAN_MAX_TABLES = 100;

export const PLAN_X_RANGE = `La columna de la mesa va de 0 a ${PLAN_COLUMNS - 1}.`;
export const PLAN_Y_RANGE = `La fila de la mesa va de 0 a ${PLAN_ROWS - 1}.`;
export const PLAN_SHAPE_INVALID =
  'Elige la forma de la mesa: square (cuadrada), round (redonda) o rect (rectangular).';
export const PLAN_TABLES_REQUIRED =
  'Envía las mesas del plano en "tables", como una lista (vacía si no hay ninguna ubicada).';
export const PLAN_TOO_MANY_TABLES = `El plano admite máximo ${PLAN_MAX_TABLES} mesas.`;
export const PLAN_TABLE_INVALID =
  'Cada mesa del plano lleva id, x, y y, si quieres, shape.';

export class PlanTableDto {
  @ApiProperty({ format: 'uuid', description: 'Id de la mesa.' })
  @IsUUID('all', { message: TABLE_ID_INVALID })
  id: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: PLAN_COLUMNS - 1,
    example: 4,
    description: 'Columna de la esquina superior izquierda.',
  })
  @IsInt({ message: PLAN_X_RANGE })
  @Min(0, { message: PLAN_X_RANGE })
  @Max(PLAN_COLUMNS - 1, { message: PLAN_X_RANGE })
  x: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: PLAN_ROWS - 1,
    example: 2,
    description: 'Fila de la esquina superior izquierda.',
  })
  @IsInt({ message: PLAN_Y_RANGE })
  @Min(0, { message: PLAN_Y_RANGE })
  @Max(PLAN_ROWS - 1, { message: PLAN_Y_RANGE })
  y: number;

  @ApiProperty({
    enum: TABLE_SHAPES,
    nullable: true,
    required: false,
    description:
      'Forma en el plano. Sin shape (o con null) es rectangular según la capacidad.',
  })
  @IsOptional()
  @IsIn(TABLE_SHAPES, { message: PLAN_SHAPE_INVALID })
  shape?: TableShape | null;
}

// The whole plan at once: tables of the restaurant that are not in the list
// end up unplaced. The restaurant comes from the session.
export class SaveTablePlanDto {
  @ApiProperty({
    type: PlanTableDto,
    isArray: true,
    maxItems: PLAN_MAX_TABLES,
    description:
      'Todas las mesas ubicadas en el plano, cada una una sola vez. Las mesas del restaurante que no estén aquí quedan sin ubicar.',
  })
  @IsArray({ message: PLAN_TABLES_REQUIRED })
  @ArrayMaxSize(PLAN_MAX_TABLES, { message: PLAN_TOO_MANY_TABLES })
  @ValidateNested({ each: true, message: PLAN_TABLE_INVALID })
  @Type(() => PlanTableDto)
  tables: PlanTableDto[];
}
