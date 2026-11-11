import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto.js';
import {
  ACCOUNT_ERROR_MESSAGES,
  CurrentIdentity,
  CurrentUserGuard,
  SESSION_UNAUTHORIZED_RESPONSE,
  type RequestIdentity,
} from '../../identity-access/index.js';
import { CONTACT_PHONE_INVALID } from './dto/contact-phone-field.js';
import { RestaurantProfileResponseDto } from './dto/restaurant-profile-response.dto.js';
import { SignupRestaurantDto } from './dto/signup-restaurant.dto.js';
import { ALREADY_REGISTERED_MESSAGE } from './restaurant-registration.service.js';
import {
  ALREADY_ENABLED_MESSAGE,
  RestaurantSignupService,
} from './restaurant-signup.service.js';

const forbidden = (
  summary: string,
  code: keyof typeof ACCOUNT_ERROR_MESSAGES,
) => ({
  summary,
  value: {
    statusCode: 403,
    message: ACCOUNT_ERROR_MESSAGES[code],
    error: 'Forbidden',
    errorCode: code,
  },
});

const conflict = (summary: string, message: string) => ({
  summary,
  value: { statusCode: 409, message, error: 'Conflict' },
});

// No @Roles on purpose, like POST /v1/diners/me: this route accepts a Firebase
// account without a users row, which is exactly what it creates.
@ApiTags('restaurants')
@ApiBearerAuth()
@UseGuards(CurrentUserGuard)
@Controller('restaurants')
export class RestaurantSignupController {
  constructor(private readonly signupService: RestaurantSignupService) {}

  @Post('signup')
  @ApiOperation({
    summary: 'Registrar un restaurante nuevo (solicitud de aprobación)',
    description:
      'Para una cuenta de Firebase con el correo verificado que todavía no tiene perfil en DiNNo. En una sola transacción crea el usuario con rol restaurant_admin y su restaurante con approvalStatus pending, con sus horarios y su teléfono de contacto (obligatorio). Mientras está pending, el restaurante no aparece para los comensales y la cuenta solo puede consultar GET /v1/me, GET /v1/restaurants/me y GET /v1/geocode; el resto responde 403 ACCOUNT_PENDING_APPROVAL. Cualquier campo que no esté en el DTO se rechaza con 400.',
  })
  @ApiCreatedResponse({
    description:
      'Solicitud creada: el restaurante queda pendiente de aprobación.',
    type: RestaurantProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos (los mismos de POST /v1/restaurants) o teléfono de contacto ausente o inválido. message es una lista.',
    type: ErrorResponseDto,
    example: {
      statusCode: 400,
      message: [CONTACT_PHONE_INVALID],
      error: 'Bad Request',
    },
  })
  @ApiUnauthorizedResponse(SESSION_UNAUTHORIZED_RESPONSE)
  @ApiForbiddenResponse({
    description:
      'La cuenta ya existe como comensal (DINER_ACCOUNT) o como administrador de DiNNo (ADMIN_ACCOUNT): no se crea nada.',
    type: ErrorResponseDto,
    examples: {
      dinerAccount: forbidden('Es una cuenta de comensal', 'DINER_ACCOUNT'),
      adminAccount: forbidden(
        'Es una cuenta de administrador de DiNNo',
        'ADMIN_ACCOUNT',
      ),
    },
  })
  @ApiConflictResponse({
    description:
      'La cuenta ya es de restaurante: con restaurante registrado, o habilitada por el equipo sin restaurante (debe usar el formulario de registro, POST /v1/restaurants). No se crea nada.',
    type: ErrorResponseDto,
    examples: {
      alreadyRegistered: conflict(
        'Ya tiene restaurante',
        ALREADY_REGISTERED_MESSAGE,
      ),
      alreadyEnabled: conflict(
        'Cuenta habilitada sin restaurante',
        ALREADY_ENABLED_MESSAGE,
      ),
    },
  })
  async signup(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() dto: SignupRestaurantDto,
  ): Promise<RestaurantProfileResponseDto> {
    const { restaurant, schedules } = await this.signupService.signup(
      identity,
      dto,
    );
    // Un restaurante recién registrado no puede tener reservas.
    return RestaurantProfileResponseDto.fromEntities(restaurant, schedules, 0);
  }
}
