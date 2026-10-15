import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import { SESSION_UNAUTHORIZED_RESPONSE } from '../auth/auth-errors.js';
import type { CurrentUserData } from '../current-user/current-user-data.js';
import { CurrentUser } from '../current-user/current-user.decorator.js';
import { CurrentUserGuard } from '../current-user/current-user.guard.js';
import { ACCOUNT_ERROR_MESSAGES } from '../roles/account-errors.js';
import { Roles } from '../roles/roles.decorator.js';
import { UserRole } from '../roles/user-role.js';
import { MeResponseDto } from './dto/me-response.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('accounts')
@ApiBearerAuth()
@Roles(UserRole.RESTAURANT_ADMIN, UserRole.DINER)
@UseGuards(CurrentUserGuard)
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Consultar la cuenta de la sesión',
    description:
      'Funciona con los dos roles. Una cuenta de Firebase sin perfil responde 403 PROFILE_REQUIRED: la app crea el perfil de comensal con POST /v1/diners/me y vuelve a consultar.',
  })
  @ApiOkResponse({ description: 'Cuenta de la sesión.', type: MeResponseDto })
  @ApiUnauthorizedResponse({
    ...SESSION_UNAUTHORIZED_RESPONSE,
    description:
      'No hay una sesión activa, o la cuenta todavía no está vinculada y su correo no está verificado (errorCode: EMAIL_NOT_VERIFIED).',
  })
  @ApiForbiddenResponse({
    description: 'La cuenta de Firebase todavía no tiene perfil.',
    type: ErrorResponseDto,
    example: {
      statusCode: 403,
      message: ACCOUNT_ERROR_MESSAGES.PROFILE_REQUIRED,
      error: 'Forbidden',
      errorCode: 'PROFILE_REQUIRED',
    },
  })
  async findMe(
    @CurrentUser() current: CurrentUserData,
  ): Promise<MeResponseDto> {
    return MeResponseDto.fromUser(
      await this.users.getSessionUser(current.userId),
    );
  }
}
