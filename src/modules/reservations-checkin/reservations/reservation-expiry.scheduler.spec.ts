import { Logger } from '@nestjs/common';
import type { ReservationExpirationService } from './reservation-expiration.service.js';
import { ReservationExpiryScheduler } from './reservation-expiry.scheduler.js';

const INTERVAL_MS = 15_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(enabled = true) {
  const expireAllDue = vi.fn<() => Promise<number>>().mockResolvedValue(0);
  const scheduler = new ReservationExpiryScheduler(
    { expireAllDue } as unknown as ReservationExpirationService,
    { enabled, intervalMs: INTERVAL_MS },
  );
  return { scheduler, expireAllDue };
}

describe('ReservationExpiryScheduler', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  const started: ReservationExpiryScheduler[] = [];

  const start = (scheduler: ReservationExpiryScheduler) => {
    started.push(scheduler);
    scheduler.onApplicationBootstrap();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    for (const scheduler of started.splice(0)) {
      await scheduler.beforeApplicationShutdown();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('barrido inicial', () => {
    it('corre una vez al arrancar, sin esperar al primer intervalo', async () => {
      const { scheduler, expireAllDue } = setup();

      start(scheduler);
      await vi.advanceTimersByTimeAsync(0);

      expect(expireAllDue).toHaveBeenCalledTimes(1);
    });

    it('registra el resultado una sola vez, aunque no haya vencido nada', async () => {
      const { scheduler } = setup();

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'Barrido inicial de reservas terminado: 0 vencidas',
      );
    });

    it('registra cuántas venció', async () => {
      const { scheduler, expireAllDue } = setup();
      expireAllDue.mockResolvedValueOnce(4);

      start(scheduler);
      await vi.advanceTimersByTimeAsync(0);

      expect(log).toHaveBeenCalledWith(
        'Barrido inicial de reservas terminado: 4 vencidas',
      );
    });

    it('no bloquea el arranque: onApplicationBootstrap vuelve aunque el barrido siga en curso', () => {
      const { scheduler, expireAllDue } = setup();
      const pending = deferred<number>();
      expireAllDue.mockReturnValueOnce(pending.promise);

      expect(start(scheduler)).toBeUndefined();

      pending.resolve(0);
    });
  });

  describe('ticks', () => {
    it('corre una vez por intervalo', async () => {
      const { scheduler, expireAllDue } = setup();

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

      expect(expireAllDue).toHaveBeenCalledTimes(4);
    });

    it('solo registra si venció algo', async () => {
      const { scheduler, expireAllDue } = setup();
      expireAllDue
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0);

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

      expect(log.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        'Barrido inicial de reservas terminado: 0 vencidas',
        'Reservas vencidas automáticamente: 2',
      ]);
    });

    it('no se solapan: si el anterior sigue en curso, el tick se salta', async () => {
      const { scheduler, expireAllDue } = setup();
      const slow = deferred<number>();
      expireAllDue.mockReturnValueOnce(slow.promise);

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
      expect(expireAllDue).toHaveBeenCalledTimes(1);

      slow.resolve(0);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(expireAllDue).toHaveBeenCalledTimes(2);
    });
  });

  describe('errores', () => {
    it('un error se registra y los ticks siguientes siguen corriendo', async () => {
      const { scheduler, expireAllDue } = setup();
      expireAllDue
        .mockResolvedValueOnce(0)
        .mockRejectedValueOnce(new Error('base caída'))
        .mockResolvedValueOnce(1);

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('base caída');
      expect(expireAllDue).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledWith('Reservas vencidas automáticamente: 1');
    });

    it('un error en el barrido inicial no da por terminado el barrido y los ticks siguen', async () => {
      const { scheduler, expireAllDue } = setup();
      expireAllDue.mockRejectedValueOnce(new Error('base dormida'));

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(error).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      expect(expireAllDue).toHaveBeenCalledTimes(2);
    });

    it('tolera un error que no es Error', async () => {
      const { scheduler, expireAllDue } = setup();
      expireAllDue.mockRejectedValueOnce('texto');

      start(scheduler);
      await vi.advanceTimersByTimeAsync(0);

      expect(error.mock.calls[0][0]).toContain('texto');
    });
  });

  describe('apagado', () => {
    it('detiene el intervalo', async () => {
      const { scheduler, expireAllDue } = setup();

      start(scheduler);
      await vi.advanceTimersByTimeAsync(0);
      await scheduler.beforeApplicationShutdown();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(expireAllDue).toHaveBeenCalledTimes(1);
    });

    it('espera la ejecución en curso antes de terminar', async () => {
      const { scheduler, expireAllDue } = setup();
      const slow = deferred<number>();
      expireAllDue.mockReturnValueOnce(slow.promise);
      let finished = false;

      start(scheduler);
      const shutdown = scheduler.beforeApplicationShutdown().then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(finished).toBe(false);

      slow.resolve(3);
      await shutdown;
      expect(finished).toBe(true);
      expect(log).toHaveBeenCalledWith(
        'Barrido inicial de reservas terminado: 3 vencidas',
      );
    });

    it('termina también si el barrido en curso falla', async () => {
      const { scheduler, expireAllDue } = setup();
      expireAllDue.mockRejectedValueOnce(new Error('roto'));

      start(scheduler);

      await expect(
        scheduler.beforeApplicationShutdown(),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('sin haber arrancado, el apagado no falla', async () => {
      const { scheduler } = setup();

      await expect(
        scheduler.beforeApplicationShutdown(),
      ).resolves.toBeUndefined();
    });
  });

  describe('con RESERVATION_EXPIRY_ENABLED=false', () => {
    it('no barre al arrancar ni programa ningún tick', async () => {
      const { scheduler, expireAllDue } = setup(false);

      start(scheduler);
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(expireAllDue).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
