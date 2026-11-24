import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type ThrottlerModuleOptions,
  ThrottlerGuard,
  getOptionsToken,
} from '@nestjs/throttler';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { RATE_LIMIT_SETTINGS } from './rate-limit.tokens.js';
import type { RateLimitSettings } from './rate-limit.settings.js';

export const RATE_LIMITED_MESSAGE =
  'Hiciste muchas solicitudes seguidas. Espera un momento e intenta de nuevo.';

// The throttler's guard with our storage, the on/off switch and a Spanish 429
// in the API's error shape ({ statusCode, message, error }, built by Nest's
// own createBody; no errorCode: the clients only show the message).
// Retry-After (seconds) comes from the throttler.
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    // Explicit on purpose: ThrottlerGuard's constructor declares
    // @Inject(ThrottlerStorage) for this position, and that metadata is
    // inherited. Without it Nest injects the throttler's in-memory storage.
    @Inject(RedisThrottlerStorage) storage: RedisThrottlerStorage,
    reflector: Reflector,
    @Inject(RATE_LIMIT_SETTINGS) private readonly settings: RateLimitSettings,
  ) {
    super(options, storage, reflector);
  }

  // Only HTTP: the WebSocket has its own limit (SocketConnectionLimiter).
  protected override async shouldSkip(
    context: ExecutionContext,
  ): Promise<boolean> {
    return !this.settings.enabled || context.getType() !== 'http';
  }

  protected override async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      HttpException.createBody(
        RATE_LIMITED_MESSAGE,
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
