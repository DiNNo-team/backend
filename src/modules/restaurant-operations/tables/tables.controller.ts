import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  CurrentUser,
  CurrentUserGuard,
  type CurrentUserData,
} from '../../identity-access/index.js';
import { CAPACITY_RANGE, CreateTableDto } from './dto/create-table.dto.js';
import { TableResponseDto } from './dto/table-response.dto.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
  TablesService,
} from './tables.service.js';

@ApiTags('tables')
@ApiUnauthorizedResponse({
  description: 'No hay una sesión activa.',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description:
    'El usuario todavía no registra su restaurante (errorCode: RESTAURANT_REQUIRED): hay que llevarlo al registro del restaurante.',
  type: ErrorResponseDto,
  example: {
    statusCode: 403,
    message: RESTAURANT_REQUIRED_MESSAGE,
    error: 'Forbidden',
    errorCode: RESTAURANT_REQUIRED_CODE,
  },
})
@UseGuards(CurrentUserGuard)
@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear una mesa en el restaurante del usuario',
    description:
      'Solo acepta identifier y capacity; cualquier otro campo (status, isActive, restaurantId…) se rechaza con 400. La mesa nace Disponible (available) y activa. El restaurante sale de la sesión.',
  })
  @ApiCreatedResponse({ description: 'Mesa creada.', type: TableResponseDto })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos: nombre de la mesa (identifier) vacío o de más de 50 caracteres, capacidad fuera de 1 a 20 o no entera, o campos no permitidos.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [CAPACITY_RANGE],
      error: 'Bad Request',
    },
  })
  @ApiConflictResponse({
    description:
      'Ya existe una mesa con ese nombre (identifier) en el restaurante, sin importar mayúsculas ni espacios.',
    type: ErrorResponseDto,
  })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateTableDto,
  ): Promise<TableResponseDto> {
    const table = await this.tablesService.create(user.restaurantId, dto);
    return TableResponseDto.fromEntity(table);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar las mesas del restaurante del usuario',
    description:
      'Devuelve todas las mesas del restaurante, activas e inactivas (isActive), ordenadas por fecha de creación, de la más antigua a la más nueva. Sin mesas, devuelve [].',
  })
  @ApiOkResponse({
    description: 'Mesas en orden de creación ascendente.',
    type: TableResponseDto,
    isArray: true,
  })
  async findAll(
    @CurrentUser() user: CurrentUserData,
  ): Promise<TableResponseDto[]> {
    const tables = await this.tablesService.findAll(user.restaurantId);
    return tables.map((table) => TableResponseDto.fromEntity(table));
  }
}
