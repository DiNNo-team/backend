import {
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import {
  REDIS_CLIENT,
  closeRedisClient,
  createRedisClient,
} from './config/redis.config.js';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module.js';
import { RestaurantOperationsModule } from './modules/restaurant-operations/restaurant-operations.module.js';
import { ReservationsCheckinModule } from './modules/reservations-checkin/reservations-checkin.module.js';
import { SearchAvailabilityModule } from './modules/search-availability/search-availability.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';

const logger = new Logger('Database');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
        return {
          type: 'postgres',
          url: databaseUrl,
          autoLoadEntities: true,
          synchronize: false,
          uuidExtension: 'pgcrypto',
          installExtensions: false,
          ssl: databaseUrl.includes('sslmode=require')
            ? { rejectUnauthorized: false }
            : false,
        };
      },
    }),
    IdentityAccessModule,
    RestaurantOperationsModule,
    ReservationsCheckinModule,
    SearchAvailabilityModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService.getOrThrow<string>('REDIS_URL')),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class AppModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    if (this.dataSource.isInitialized) {
      logger.log('PostgreSQL conectado');
    }
  }

  // Runs on app.close() and, through enableShutdownHooks in main.ts, on the
  // SIGTERM Render sends before replacing the instance.
  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}
