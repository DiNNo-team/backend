import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
  Roles,
  type CurrentUserData,
  UserRole,
} from '../../identity-access/index.js';
import {
  RESTAURANT_REQUIRED_CODE,
  RESTAURANT_REQUIRED_MESSAGE,
} from '../shared/restaurant-required.js';
import { TABLE_ID_INVALID } from '../shared/table-id-invalid.js';
import { TableLogResponseDto } from './dto/table-log-response.dto.js';
import { TableLogsQueryDto } from './dto/table-logs-query.dto.js';
import { TABLE_LOGS_LIMIT, TableLogsService } from './table-logs.service.js';

@ApiTags('table-logs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description:
    'No hay una sesión activa o el correo no está verificado (errorCode: EMAIL_NOT_VERIFIED).',
  type: ErrorResponseDto,
  example: {
    statusCode: 401,
    message: 'Verifica tu correo para continuar.',
    error: 'Unauthorized',
    errorCode: 'EMAIL_NOT_VERIFIED',
  },
})
@ApiForbiddenResponse({
  description:
    'El usuario no tiene acceso por rol, o todavía no registra su restaurante (errorCode: RESTAURANT_REQUIRED).',
  type: ErrorResponseDto,
  examples: {
    insufficientRole: {
      summary: 'El rol no permite ver la bitácora',
      value: {
        statusCode: 403,
        message: 'No tienes acceso a esta sección.',
        error: 'Forbidden',
      },
    },
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
@Controller('table-logs')
export class TableLogsController {
  constructor(private readonly tableLogsService: TableLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar la bitácora de cambios de las mesas del restaurante',
    description: `Cambios de estado, desactivaciones y reactivaciones de las mesas del restaurante del usuario de la sesión, del más reciente al más antiguo, con un máximo de ${TABLE_LOGS_LIMIT} filas (sin paginación). Con tableId solo devuelve los de esa mesa; si la mesa no existe o es de otro restaurante, devuelve []. El restaurante sale siempre de la sesión: cualquier otro parámetro se rechaza con 400.`,
  })
  @ApiOkResponse({
    description: `Cambios del más reciente al más antiguo, máximo ${TABLE_LOGS_LIMIT}. Sin cambios, [].`,
    type: TableLogResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'tableId no es un UUID o la consulta trae un parámetro que no existe (por ejemplo, restaurantId). message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [TABLE_ID_INVALID],
      error: 'Bad Request',
    },
  })
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: TableLogsQueryDto,
  ): Promise<TableLogResponseDto[]> {
    const rows = await this.tableLogsService.findForRestaurant(
      user.restaurantId,
      query.tableId,
    );
    return rows.map((row) => TableLogResponseDto.fromRow(row));
  }
}
