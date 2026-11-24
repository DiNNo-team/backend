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
import { SocketIoRedisAdapter } from './socket-io-redis.js';

// The one Redis connection of the app, global so any module (the rate limit)
// injects it with REDIS_CLIENT without importing AppModule. Registered once,
// in AppModule. The Socket.IO adapter (main.ts) duplicates it into its own
// two connections.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService.getOrThrow<string>('REDIS_URL')),
    },
    SocketIoRedisAdapter,
  ],
  exports: [REDIS_CLIENT, SocketIoRedisAdapter],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Runs on app.close() and, through enableShutdownHooks in main.ts, on the
  // SIGTERM the platform sends before replacing the instance.
  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}
