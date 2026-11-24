import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../config/redis.config.js';

// Puerto de la caché del informe: las pruebas lo reemplazan por una en memoria.
export abstract class InsightsCache {
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const INSIGHTS_CACHE_PREFIX = 'dinno:insights:v1:';

// Una llamada a Redis que tarda más que esto cuenta como Redis caído: el
// informe no espera por la caché (mismo criterio que el límite de peticiones).
export const CACHE_TIMEOUT_MS = 250;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Redis tardó más de ${CACHE_TIMEOUT_MS} ms`)),
        CACHE_TIMEOUT_MS,
      ).unref(),
    ),
  ]);
}

// La caché vive en Redis (una por todas las réplicas). Si Redis no está listo,
// falla o tarda, el informe se calcula igual sin caché: nunca tumba la ruta. El
// límite @RateLimit('ai') sigue controlando cuántas veces se genera.
@Injectable()
export class RedisInsightsCache extends InsightsCache {
  private readonly logger = new Logger('Insights');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async get(key: string): Promise<string | null> {
    if (this.redis.status !== 'ready') return null;
    try {
      return await withTimeout(this.redis.get(INSIGHTS_CACHE_PREFIX + key));
    } catch (error) {
      this.warn('leer', error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis.status !== 'ready') return;
    try {
      await withTimeout(
        this.redis.set(INSIGHTS_CACHE_PREFIX + key, value, 'EX', ttlSeconds),
      );
    } catch (error) {
      this.warn('guardar', error);
    }
  }

  private warn(action: string, error: unknown): void {
    this.logger.warn(
      `No se pudo ${action} el informe en la caché (${error instanceof Error ? error.message : 'error desconocido'}); se sigue sin caché.`,
    );
  }
}
