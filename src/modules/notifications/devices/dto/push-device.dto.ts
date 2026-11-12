import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import {
  PUSH_PLATFORMS,
  PUSH_TOKEN_MAX_LENGTH,
  type PushPlatform,
} from '../push-device.entity.js';

export const PUSH_TOKEN_INVALID =
  'El token de notificaciones no es válido. Vuelve a abrir la app.';
export const PUSH_PLATFORM_INVALID = `La plataforma debe ser una de: ${PUSH_PLATFORMS.join(', ')}.`;

class PushTokenField {
  @ApiProperty({
    description:
      'Token de registro de Firebase Cloud Messaging del teléfono (getDevicePushTokenAsync en Android).',
    example: 'dXJ3b...:APA91bH...',
    maxLength: PUSH_TOKEN_MAX_LENGTH,
  })
  @IsString({ message: PUSH_TOKEN_INVALID })
  @Length(1, PUSH_TOKEN_MAX_LENGTH, { message: PUSH_TOKEN_INVALID })
  token: string;
}

// The diner comes from the session, never from the body.
export class RegisterPushDeviceDto extends PushTokenField {
  @ApiProperty({ enum: PUSH_PLATFORMS, example: 'android' })
  @IsIn(PUSH_PLATFORMS, { message: PUSH_PLATFORM_INVALID })
  platform: PushPlatform;
}

export class UnregisterPushDeviceDto extends PushTokenField {}
