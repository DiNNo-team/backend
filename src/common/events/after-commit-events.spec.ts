import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AfterCommitEvents } from './after-commit-events.js';

const emitter = (emit = vi.fn()) => ({
  emit,
  bus: { emit } as unknown as EventEmitter2,
});

describe('AfterCommitEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no emite nada al acumular: solo al publicar, y en el orden en que llegaron', () => {
    const { emit, bus } = emitter();
    const events = new AfterCommitEvents();

    events.add('uno', { n: 1 });
    events.add('dos', { n: 2 });
    expect(emit).not.toHaveBeenCalled();

    events.publish(bus);

    expect(emit.mock.calls).toEqual([
      ['uno', { n: 1 }],
      ['dos', { n: 2 }],
    ]);
  });

  it('no publica si la transacción hace rollback: la excepción salta el publish', async () => {
    const { emit, bus } = emitter();
    const events = new AfterCommitEvents();
    const failingTransaction = (work: () => void) => {
      work();
      return Promise.reject(new Error('rollback'));
    };

    const run = async () => {
      await failingTransaction(() => events.add('uno', {}));
      events.publish(bus);
    };

    await expect(run()).rejects.toThrow('rollback');
    expect(emit).not.toHaveBeenCalled();
  });

  it('publicar dos veces no duplica', () => {
    const { emit, bus } = emitter();
    const events = new AfterCommitEvents();
    events.add('uno', {});

    events.publish(bus);
    events.publish(bus);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('si un emit falla, lo registra, sigue con los demás y no lanza: la operación ya se confirmó', () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { emit, bus } = emitter(
      vi
        .fn()
        .mockImplementationOnce(() => {
          throw new TypeError('roto');
        })
        .mockReturnValue(true),
    );
    const events = new AfterCommitEvents();
    events.add('uno', {});
    events.add('dos', {});

    expect(() => events.publish(bus)).not.toThrow();

    expect(emit).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(
      'No se pudo publicar el evento uno: TypeError',
    );
  });
});
