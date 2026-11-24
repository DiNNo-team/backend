import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.config.js';

// What the throttler expects back (ThrottlerStorageRecord): times in seconds.
export interface RateLimitRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

export const RATE_LIMIT_KEY_PREFIX = 'dinno:rl:';

// A Redis call that takes longer than this counts as Redis being down: the
// request must not wait for a limit.
export const REDIS_TIMEOUT_MS = 250;

// Fixed window: the first hit creates the key with its TTL; the rest add one.
// PTTL < 0 only if a key lost its TTL (should not happen): it gets it again.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }
`;

// The counters live in Redis, so with two replicas a caller has one limit, not
// one per replica. If Redis is down or slow, each replica counts in its own
// memory: the limit gets looser for a while, but the API keeps answering
// (Sprint 4: "si Redis cae, las operaciones críticas siguen funcionando").
//
// blockDuration is not used: a caller over the limit waits for the window to
// end, the throttler's default when no blockDuration is given.
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimit');
  private readonly memory = new ThrottlerStorageService();
  private usingMemory = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<RateLimitRecord> {
    if (this.redis.status === 'ready') {
      try {
        const record = await this.incrementInRedis(key, ttl, limit);
        this.backToRedis();
        return record;
      } catch (error) {
        this.fallBack(error);
      }
    } else {
      this.fallBack(new Error(`Redis ${this.redis.status}`));
    }
    return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
  }

  // The memory store keeps a timer; Nest does not manage this instance.
  onApplicationShutdown(): void {
    this.memory.onApplicationShutdown();
  }

  private async incrementInRedis(
    key: string,
    ttlMs: number,
    limit: number,
  ): Promise<RateLimitRecord> {
    const reply = await withTimeout(
      this.redis.eval(
        INCREMENT_SCRIPT,
        1,
        `${RATE_LIMIT_KEY_PREFIX}${key}`,
        ttlMs,
      ),
      REDIS_TIMEOUT_MS,
    );
    const [hits, pttl] = parseReply(reply);
    const seconds = Math.max(1, Math.ceil(pttl / 1000));
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire: seconds,
      isBlocked,
      timeToBlockExpire: isBlocked ? seconds : 0,
    };
  }

  // One WARN when Redis stops answering and one LOG when it is back, not one
  // per request.
  private fallBack(error: unknown): void {
    if (this.usingMemory) {
      return;
    }
    this.usingMemory = true;
    this.logger.warn(
      `Redis no responde (${error instanceof Error ? error.message : 'error'}): el límite de peticiones se cuenta en la memoria de esta instancia.`,
    );
  }

  private backToRedis(): void {
    if (!this.usingMemory) {
      return;
    }
    this.usingMemory = false;
    this.logger.log(
      'Redis responde otra vez: el límite de peticiones vuelve a Redis.',
    );
  }
}

function parseReply(reply: unknown): [number, number] {
  if (
    Array.isArray(reply) &&
    reply.length === 2 &&
    reply.every((value) => typeof value === 'number')
  ) {
    return [reply[0] as number, reply[1] as number];
  }
  throw new Error('respuesta inesperada');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
