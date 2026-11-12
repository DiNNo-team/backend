import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  CurrentUser,
  CurrentUserGuard,
  DINER_ENDPOINT_ACCOUNT_EXAMPLES,
  Roles,
  SESSION_UNAUTHORIZED_RESPONSE,
  UserRole,
  type CurrentUserData,
} from '../../identity-access/index.js';
import {
  PUSH_TOKEN_INVALID,
  RegisterPushDeviceDto,
  UnregisterPushDeviceDto,
} from './dto/push-device.dto.js';
import { PushDevicesService } from './push-devices.service.js';

const BAD_TOKEN = {
  description:
    'El token falta, no es texto o pasa de 4096 caracteres, la plataforma no es android ni ios, o llega un campo que no existe. message es una lista.',
  type: ErrorResponseDto,
  example: {
    statusCode: 400,
    message: [PUSH_TOKEN_INVALID],
    error: 'Bad Request',
  },
};

// Phones of the diner that receive the reservation notifications (Sprint 4,
// PBI 1.1). The diner comes from the session.
@ApiTags('notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
@ApiForbiddenResponse({
  description:
    'La cuenta todavía no tiene perfil (PROFILE_REQUIRED) o es de restaurante (RESTAURANT_ACCOUNT).',
  type: ErrorResponseDto,
  examples: DINER_ENDPOINT_ACCOUNT_EXAMPLES,
})
@Roles(UserRole.DINER)
@UseGuards(CurrentUserGuard)
@Controller('notifications/devices')
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registrar el teléfono para recibir notificaciones',
    description:
      'Guarda el token de notificaciones del teléfono para el comensal de la sesión. Es idempotente: la app lo llama en cada inicio. Si el token ya estaba con otra cuenta (otra sesión en el mismo teléfono), pasa a esta.',
  })
  @ApiNoContentResponse({ description: 'Teléfono registrado.' })
  @ApiBadRequestResponse(BAD_TOKEN)
  async register(
    @CurrentUser() user: CurrentUserData,
    @Body() body: RegisterPushDeviceDto,
  ): Promise<void> {
    await this.devices.register(user.userId, body.token, body.platform);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Dejar de recibir notificaciones en este teléfono',
    description:
      'Borra el token del comensal de la sesión. La app lo llama antes de cerrar sesión. Un token que no existe o es de otra cuenta responde 204 igual.',
  })
  @ApiNoContentResponse({ description: 'Teléfono olvidado.' })
  @ApiBadRequestResponse(BAD_TOKEN)
  async unregister(
    @CurrentUser() user: CurrentUserData,
    @Body() body: UnregisterPushDeviceDto,
  ): Promise<void> {
    await this.devices.unregister(user.userId, body.token);
  }
}
