import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  REDIS_CLIENT,
  closeRedisClient,
  createRedisClient,
} from './redis.config.js';

// The one Redis connection of the app, global so any module (the rate limit,
// later the Socket.IO adapter) injects it with REDIS_CLIENT without importing
// AppModule. Registered once, in AppModule.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService.getOrThrow<string>('REDIS_URL')),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Runs on app.close() and, through enableShutdownHooks in main.ts, on the
  // SIGTERM the platform sends before replacing the instance.
  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}
