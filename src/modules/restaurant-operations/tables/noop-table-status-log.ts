import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { TableStatusLog } from './table-status-log.js';

// Placeholder until the table log (PBI 6, Sergio) provides the real
// TableStatusLog: status changes work, but nothing is recorded.
@Injectable()
export class NoopTableStatusLog
  extends TableStatusLog
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(NoopTableStatusLog.name);

  onApplicationBootstrap(): void {
    this.logger.warn(
      'La bitácora de mesas todavía no está implementada: los cambios de estado no se registran (NoopTableStatusLog).',
    );
  }

  record(): Promise<void> {
    return Promise.resolve();
  }
}
