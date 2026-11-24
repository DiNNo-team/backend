import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisModule } from './config/redis.module.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { IdentityAccessModule } from './modules/identity-access/identity-access.module.js';
import { RequireTableReservationsPort } from './modules/restaurant-operations/index.js';
import { RestaurantOperationsModule } from './modules/restaurant-operations/restaurant-operations.module.js';
import { ReservationExpiryModule } from './modules/reservations-checkin/index.js';
import { ReservationsCheckinModule } from './modules/reservations-checkin/reservations-checkin.module.js';
import { SearchAvailabilityModule } from './modules/search-availability/search-availability.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { InsightsModule } from './modules/insights/index.js';
import { databaseSsl } from './config/database-ssl.js';

const logger = new Logger('Database');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Internal events between modules (Sprint 2, real time): registered once
    // here, global. restaurant-operations emits, search-availability listens.
    EventEmitterModule.forRoot(),
    RedisModule,
    // Límite de peticiones de toda la API y del WebSocket (Sprint 4, tarea 6.1.3).
    RateLimitModule,
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
          ssl: databaseSsl(databaseUrl),
          // Passed to pg as connectionTimeoutMillis: without it a request
          // waits forever for a connection. 10 s because free Neon takes a
          // few seconds to wake up; less would fail healthy requests.
          connectTimeoutMS: 10_000,
        };
      },
    }),
    IdentityAccessModule,
    RestaurantOperationsModule,
    ReservationsCheckinModule,
    // El proceso que vence reservas cada 15 s: solo en la aplicación real.
    ReservationExpiryModule,
    SearchAvailabilityModule,
    NotificationsModule,
    // Informe inteligente del restaurante (IA, Sprint 4): solo lectura.
    InsightsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // La composición real exige que reservations-checkin registre el puerto de
    // reservas de las mesas: si falta, la app no arranca (en vez de dejar las
    // mesas con reserva activa sin proteger).
    RequireTableReservationsPort,
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    if (this.dataSource.isInitialized) {
      logger.log('PostgreSQL conectado');
    }
  }
}
