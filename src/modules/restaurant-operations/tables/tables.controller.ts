import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
  STATUS_INVALID,
  UpdateTableStatusDto,
} from './dto/update-table-status.dto.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
} from '../shared/restaurant-required.js';
import {
  TABLE_INACTIVE_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  TablesService,
} from './tables.service.js';

const TABLE_ID_INVALID = 'El id de la mesa no es un UUID válido.';

// :id of every /tables/:id route. Checked before the query: Postgres rejects a
// malformed uuid with a 500. A list, like the other validation 400s.
const TableIdParam = () =>
  Param(
    'id',
    new ParseUUIDPipe({
      exceptionFactory: () => new BadRequestException([TABLE_ID_INVALID]),
    }),
  );

@ApiTags('tables')
@ApiBearerAuth()
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

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Cambiar el estado de una mesa',
    description:
      'Cambia el estado de una mesa activa del restaurante del usuario a Disponible, Reservada u Ocupada, y lo registra en la bitácora en la misma transacción: si la bitácora falla, el estado no cambia. Poner el estado que la mesa ya tiene es válido: responde 200 con la mesa sin cambios y no se registra en la bitácora (sirve para un "Deshacer" sin errores).',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id de la mesa.' })
  @ApiOkResponse({
    description:
      'Mesa con su estado nuevo. También responde 200 si el estado pedido es el que ya tenía.',
    type: TableResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'El estado no es available, reserved ni occupied, falta, o el id no es un UUID. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [STATUS_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse({
    description:
      'La mesa no existe o es de otro restaurante (mismo mensaje en los dos casos). Conviene recargar la lista de mesas.',
    type: ErrorResponseDto,
    example: {
      statusCode: 404,
      message: TABLE_NOT_FOUND_MESSAGE,
      error: 'Not Found',
    },
  })
  @ApiConflictResponse({
    description:
      'La mesa está inactiva (isActive: false): una mesa desactivada no cambia de estado.',
    type: ErrorResponseDto,
    example: {
      statusCode: 409,
      message: TABLE_INACTIVE_MESSAGE,
      error: 'Conflict',
    },
  })
  async updateStatus(
    @CurrentUser() user: CurrentUserData,
    @TableIdParam() id: string,
    @Body() dto: UpdateTableStatusDto,
  ): Promise<TableResponseDto> {
    const table = await this.tablesService.updateStatus(user, id, dto.status);
    return TableResponseDto.fromEntity(table);
  }
}
