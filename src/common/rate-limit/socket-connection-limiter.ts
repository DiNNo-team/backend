import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { clientIp, ipTracker } from './request-tracker.js';
import {
  type RateLimitSettings,
  SOCKET_CONNECTION_RULE,
  scaled,
} from './rate-limit.settings.js';
import { RATE_LIMIT_SETTINGS } from './rate-limit.tokens.js';

// The code a rejected handshake gets in `connect_error` (CLAUDE.md §12.14).
export const SOCKET_RATE_LIMITED = 'RATE_LIMITED';

export interface SocketHandshakeInfo {
  headers: IncomingHttpHeaders;
  address: string | undefined;
}

// New WebSocket connections per IP, before the handshake checks the token
// (so a flood of connections never reaches Firebase). Same counters and same
// fallback as the HTTP limit.
@Injectable()
export class SocketConnectionLimiter {
  private readonly logger = new Logger('RateLimit');

  constructor(
    private readonly storage: RedisThrottlerStorage,
    @Inject(RATE_LIMIT_SETTINGS) private readonly settings: RateLimitSettings,
  ) {}

  async allows(handshake: SocketHandshakeInfo): Promise<boolean> {
    if (!this.settings.enabled) {
      return true;
    }
    const ip = clientIp(
      handshake.address,
      handshake.headers['x-forwarded-for'],
      this.settings.trustProxyHops,
    );
    const rule = scaled(SOCKET_CONNECTION_RULE, this.settings.factor);
    const record = await this.storage.increment(
      `socket:${ipTracker(ip)}`,
      rule.ttlMs,
      rule.limit,
      rule.ttlMs,
      'socket',
    );
    if (record.isBlocked) {
      this.logger.warn(
        'Conexión de WebSocket rechazada por el límite de conexiones.',
      );
    }
    return !record.isBlocked;
  }
}
