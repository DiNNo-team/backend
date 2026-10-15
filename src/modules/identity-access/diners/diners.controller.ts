import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import { SESSION_UNAUTHORIZED_RESPONSE } from '../auth/auth-errors.js';
import type { RequestIdentity } from '../current-user/current-user-data.js';
import { CurrentIdentity } from '../current-user/current-user.decorator.js';
import { CurrentUserGuard } from '../current-user/current-user.guard.js';
import { ACCOUNT_ERROR_MESSAGES } from '../roles/account-errors.js';
import { MeResponseDto } from '../users/dto/me-response.dto.js';
import { DinersService } from './diners.service.js';
import { RegisterDinerDto } from './dto/register-diner.dto.js';

// No @Roles on purpose: this route accepts a Firebase account without a
// users row, which is exactly what it creates.
@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller('diners')
export class DinersController {
  constructor(private readonly diners: DinersService) {}

  @Post('me')
  @ApiOperation({
    summary: 'Crear el perfil de comensal de la cuenta de la sesión',
    description:
      'Exige el correo verificado. Crea el usuario con rol diner (201) o, si ya existía como comensal, responde 200 con su perfil sin cambiar nada. displayName es opcional: si no se envía, se usa el nombre de la cuenta de Google y, si no hay, la parte del correo antes de @ (máximo 60 caracteres). Cualquier otro campo se rechaza con 400.',
  })
  @ApiCreatedResponse({ description: 'Comensal creado.', type: MeResponseDto })
  @ApiOkResponse({
    description: 'La cuenta ya era de comensal: no cambia nada.',
    type: MeResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'displayName vacío, null, de más de 60 caracteres o que no es texto, o un campo que no existe. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: ['Escribe tu nombre.'],
      error: 'Bad Request',
    },
  })
  @ApiUnauthorizedResponse({
    ...SESSION_UNAUTHORIZED_RESPONSE,
    description:
      'No hay una sesión activa, o el correo no está verificado (errorCode: EMAIL_NOT_VERIFIED).',
  })
  @ApiForbiddenResponse({
    description:
      'El correo o la cuenta ya son de un restaurante: un restaurante no puede ser comensal.',
    type: ErrorResponseDto,
    example: {
      statusCode: 403,
      message: ACCOUNT_ERROR_MESSAGES.RESTAURANT_ACCOUNT,
      error: 'Forbidden',
      errorCode: 'RESTAURANT_ACCOUNT',
    },
  })
  async register(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() dto: RegisterDinerDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponseDto> {
    const { user, created } = await this.diners.register(
      identity,
      dto?.displayName,
    );
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return MeResponseDto.fromUser(user);
  }
}
