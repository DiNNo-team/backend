import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiNoContentResponse,
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
  RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  type CurrentUserData,
  UserRole,
  SESSION_UNAUTHORIZED_RESPONSE,
} from '../../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
} from '../shared/restaurant-required.js';
import { SaveTableAreaDto } from './dto/save-table-area.dto.js';
import { TableAreaResponseDto } from './dto/table-area-response.dto.js';
import {
  AREA_ID_INVALID,
  AREA_NAME_REQUIRED,
  AREA_NOT_FOUND_MESSAGE,
  AREAS_LIMIT_MESSAGE,
  areaNameTakenMessage,
} from './table-area-rules.js';
import { TableAreasService } from './table-areas.service.js';

const NOT_FOUND_RESPONSE = {
  description:
    'La zona no existe o es de otro restaurante (mismo mensaje en los dos casos).',
  type: ErrorResponseDto,
  example: {
    statusCode: 404,
    message: AREA_NOT_FOUND_MESSAGE,
    error: 'Not Found',
  },
};

const BAD_REQUEST_RESPONSE = {
  description:
    'Nombre vacío, de más de 30 caracteres o con caracteres invisibles, campos no permitidos o id que no es un UUID. message es una lista.',
  type: ErrorResponseDto,
  example: {
    statusCode: 400,
    message: [AREA_NAME_REQUIRED],
    error: 'Bad Request',
  },
};

const NAME_TAKEN_EXAMPLE = {
  statusCode: 409,
  message: areaNameTakenMessage('Terraza'),
  error: 'Conflict',
};

// :id of every /table-areas/:id route, checked before the query.
const AreaIdParam = () =>
  Param(
    'id',
    new ParseUUIDPipe({
      exceptionFactory: () => new BadRequestException([AREA_ID_INVALID]),
    }),
  );

@ApiTags('table-areas')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@ApiForbiddenResponse({
  description:
    'La cuenta no está habilitada como restaurante (errorCode: ACCOUNT_NOT_ENABLED), es de comensal (DINER_ACCOUNT) o todavía no registra su restaurante (RESTAURANT_REQUIRED).',
  type: ErrorResponseDto,
  examples: {
    ...RESTAURANT_ENDPOINT_ACCOUNT_EXAMPLES,
    restaurantRequired: {
      summary: 'El usuario todavía no registra su restaurante',
      value: {
        statusCode: 403,
        message: RESTAURANT_REQUIRED_MESSAGE,
        error: 'Forbidden',
        errorCode: RESTAURANT_REQUIRED_CODE,
      },
    },
  },
})
@Roles(UserRole.RESTAURANT_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('table-areas')
export class TableAreasController {
  constructor(private readonly areasService: TableAreasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las zonas del restaurante',
    description:
      'Las zonas organizan las mesas de un restaurante grande ("Piso 1", "Terraza", "Bar"): cada zona tiene su propio plano y la web filtra las mesas por zona. Ordenadas por fecha de creación. Sin zonas, devuelve [] y todas las mesas tienen areaId en null.',
  })
  @ApiOkResponse({ type: TableAreaResponseDto, isArray: true })
  async findAll(
    @CurrentUser() user: CurrentUserData,
  ): Promise<TableAreaResponseDto[]> {
    const areas = await this.areasService.findAll(user.restaurantId);
    return areas.map((area) => TableAreaResponseDto.fromEntity(area));
  }

  @Post()
  @ApiOperation({
    summary: 'Crear una zona',
    description:
      'Solo recibe name. Máximo 20 zonas por restaurante. No cambia ninguna mesa: se asignan con areaId en POST o PATCH /v1/tables.',
  })
  @ApiCreatedResponse({ type: TableAreaResponseDto })
  @ApiBadRequestResponse(BAD_REQUEST_RESPONSE)
  @ApiConflictResponse({
    description:
      'Ya existe una zona con ese nombre (sin importar mayúsculas ni espacios) o el restaurante ya tiene 20 zonas.',
    type: ErrorResponseDto,
    examples: {
      nameTaken: { summary: 'Nombre repetido', value: NAME_TAKEN_EXAMPLE },
      limit: {
        summary: 'Máximo de zonas',
        value: {
          statusCode: 409,
          message: AREAS_LIMIT_MESSAGE,
          error: 'Conflict',
        },
      },
    },
  })
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SaveTableAreaDto,
  ): Promise<TableAreaResponseDto> {
    const area = await this.areasService.create(user.restaurantId, dto.name);
    return TableAreaResponseDto.fromEntity(area);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cambiar el nombre de una zona',
    description: 'Solo recibe name. Las mesas de la zona no cambian.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id de la zona.' })
  @ApiOkResponse({ type: TableAreaResponseDto })
  @ApiBadRequestResponse(BAD_REQUEST_RESPONSE)
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    description: 'Ya existe otra zona con ese nombre.',
    type: ErrorResponseDto,
    example: NAME_TAKEN_EXAMPLE,
  })
  async rename(
    @CurrentUser() user: CurrentUserData,
    @AreaIdParam() id: string,
    @Body() dto: SaveTableAreaDto,
  ): Promise<TableAreaResponseDto> {
    const area = await this.areasService.rename(
      user.restaurantId,
      id,
      dto.name,
    );
    return TableAreaResponseDto.fromEntity(area);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar una zona',
    description:
      'Las mesas de la zona no se borran: quedan sin zona (areaId en null) y fuera del plano (planX, planY y planShape en null), porque podrían quedar encima de las mesas sin zona. No cambia su estado ni se registra en la bitácora.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id de la zona.' })
  @ApiNoContentResponse({ description: 'Zona eliminada.' })
  @ApiBadRequestResponse({
    description: 'El id no es un UUID.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [AREA_ID_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiNotFoundResponse(NOT_FOUND_RESPONSE)
  async remove(
    @CurrentUser() user: CurrentUserData,
    @AreaIdParam() id: string,
  ): Promise<void> {
    await this.areasService.remove(user.restaurantId, id);
  }
}
