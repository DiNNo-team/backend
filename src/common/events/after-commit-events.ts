import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';

const logger = new Logger('AfterCommitEvents');

// Eventos internos de UNA transacción: se acumulan mientras corre y se publican
// después de su commit. Uso:
//
//   const afterCommit = new AfterCommitEvents();
//   await dataSource.transaction(async (manager) => { ...; afterCommit.add(...) });
//   afterCommit.publish(this.events);
//
// Si la transacción (o su COMMIT) falla, la excepción salta el publish y lo
// acumulado se pierde con el colector: un rollback nunca publica. Se crea uno
// por transacción; si se reintenta la transacción, uno por intento.
export class AfterCommitEvents {
  private readonly pending: { name: string; payload: object }[] = [];

  add(name: string, payload: object): void {
    this.pending.push({ name, payload });
  }

  // La operación ya se confirmó: un fallo al avisar se registra y no llega a
  // quien la pidió (los clientes se recuperan consultando). Cada evento sale una
  // sola vez, aunque se llame dos veces.
  publish(emitter: EventEmitter2): void {
    for (const { name, payload } of this.pending.splice(0)) {
      try {
        emitter.emit(name, payload);
      } catch (error) {
        logger.error(
          `No se pudo publicar el evento ${name}: ${error instanceof Error ? error.name : 'error desconocido'}`,
        );
      }
    }
  }
}
