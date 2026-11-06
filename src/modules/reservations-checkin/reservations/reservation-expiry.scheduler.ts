import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ReservationExpirationService } from './reservation-expiration.service.js';
import { ReservationExpiryConfig } from './reservation-expiry.config.js';

// El proceso periódico de vencimiento (CLAUDE.md §12.5): un barrido al arrancar,
// para lo que quedó pendiente con el servidor apagado, y luego uno por intervalo.
// Solo lo carga ReservationExpiryModule, que importa únicamente AppModule: las
// pruebas que montan módulos aislados nunca lo ejecutan.
@Injectable()
export class ReservationExpiryScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ReservationExpiryScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;

  constructor(
    private readonly expiration: ReservationExpirationService,
    private readonly config: ReservationExpiryConfig,
  ) {}

  // Sin await a propósito: una base lenta en despertar no retrasa la apertura del
  // puerto. Si el primer tick llega con el barrido inicial en curso, se salta.
  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      return;
    }
    this.startSweep((expired) => {
      this.logger.log(
        `Barrido inicial de reservas terminado: ${expired} vencidas`,
      );
    });
    this.timer = setInterval(() => {
      this.startSweep((expired) => {
        if (expired > 0) {
          this.logger.log(`Reservas vencidas automáticamente: ${expired}`);
        }
      });
    }, this.config.intervalMs);
  }

  // Aquí y no en onApplicationShutdown: TypeORM destruye el DataSource en ese
  // hook, y Nest corre todos los beforeApplicationShutdown antes. Así el barrido
  // en curso termina con sus conexiones abiertas.
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  // Nunca dos a la vez: si el anterior sigue en curso, este no arranca.
  private startSweep(report: (expired: number) => void): void {
    if (this.running) {
      return;
    }
    this.running = this.sweep(report).finally(() => {
      this.running = null;
    });
  }

  // Un error no detiene los barridos siguientes ni tumba la app: se registra, y
  // lo que no se venció sigue debido para el próximo barrido.
  private async sweep(report: (expired: number) => void): Promise<void> {
    try {
      report(await this.expiration.expireAllDue());
    } catch (error) {
      this.logger.error(
        `No se pudo completar el barrido de reservas vencidas: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
