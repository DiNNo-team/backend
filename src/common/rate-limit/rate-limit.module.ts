import { Module } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerOptions } from '@nestjs/throttler';
import { routeRateLimitTags } from './rate-limit.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import {
  RATE_LIMIT_RULES,
  RATE_LIMIT_TAGS,
  type RateLimitSettings,
  readRateLimitSettings,
  scaled,
} from './rate-limit.settings.js';
import { RATE_LIMIT_SETTINGS } from './rate-limit.tokens.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { callerTracker, ipTracker } from './request-tracker.js';
import { SocketConnectionLimiter } from './socket-connection-limiter.js';

// The throttler types the request loosely; these are the two fields we read.
function requestIp(req: Record<string, unknown>): string {
  return typeof req.ip === 'string' ? req.ip : 'unknown';
}

function requestCaller(req: Record<string, unknown>): string {
  return callerTracker(req.headers as IncomingHttpHeaders, requestIp(req));
}

// One counter per limit and caller, shared by every route with that limit
// (the throttler's default key is per route).
const sharedKey = (_context: unknown, tracker: string, name: string) =>
  `${name}:${tracker}`;

export function buildThrottlers(
  settings: RateLimitSettings,
): ThrottlerOptions[] {
  const rule = (name: keyof typeof RATE_LIMIT_RULES) => {
    const { limit, ttlMs } = scaled(RATE_LIMIT_RULES[name], settings.factor);
    return { name, limit, ttl: ttlMs, generateKey: sharedKey };
  };
  return [
    {
      ...rule('ip'),
      getTracker: (req) => ipTracker(requestIp(req)),
    },
    {
      ...rule('caller'),
      getTracker: requestCaller,
    },
    ...RATE_LIMIT_TAGS.map((tag) => ({
      ...rule(tag),
      getTracker: requestCaller,
      skipIf: (context: Parameters<typeof routeRateLimitTags>[0]) =>
        !routeRateLimitTags(context).includes(tag),
    })),
  ];
}

// Límite de peticiones de la API (guard global) y de conexiones del WebSocket.
// Necesita REDIS_CLIENT (RedisModule, global). Registrado solo en AppModule.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: buildThrottlers(readRateLimitSettings(config)),
      }),
    }),
  ],
  providers: [
    {
      provide: RATE_LIMIT_SETTINGS,
      inject: [ConfigService],
      useFactory: readRateLimitSettings,
    },
    RedisThrottlerStorage,
    SocketConnectionLimiter,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [SocketConnectionLimiter, RATE_LIMIT_SETTINGS],
})
export class RateLimitModule {}
