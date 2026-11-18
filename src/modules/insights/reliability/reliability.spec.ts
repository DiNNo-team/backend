import {
  enoughMetrics,
  insufficientMetrics,
} from '../../../../test/support/insights-data.js';
import { reliabilityOf } from './reliability.js';

describe('reliabilityOf', () => {
  it('sin datos suficientes: sin nivel ni motivos', () => {
    expect(reliabilityOf(insufficientMetrics())).toEqual({
      level: null,
      reasons: [],
    });
  });

  it('alta: check-in ≥ 70 % y cambios manuales en más de la mitad de los días', () => {
    const result = reliabilityOf(
      enoughMetrics({ checkInRate: 0.7 }, [1, 1, 1, 1, 0, 0, 0]),
    );
    expect(result).toEqual({
      level: 'high',
      reasons: [
        'Tasa de check-in del 70 %',
        'Actualizaste tus mesas a mano en 4 de 7 días',
      ],
    });
  });

  it('media si el check-in es alto pero las mesas se actualizan la mitad de los días o menos', () => {
    const result = reliabilityOf(
      enoughMetrics({ checkInRate: 0.9 }, [1, 1, 1, 0, 0, 0, 0]),
    );
    expect(result.level).toBe('medium');
  });

  it('baja con check-in < 40 %', () => {
    expect(reliabilityOf(enoughMetrics({ checkInRate: 0.39 })).level).toBe(
      'low',
    );
    expect(reliabilityOf(enoughMetrics({ checkInRate: 0.4 })).level).toBe(
      'medium',
    );
  });

  it('baja sin ningún cambio manual de mesas, aunque el check-in sea alto', () => {
    const result = reliabilityOf(
      enoughMetrics({ checkInRate: 0.95 }, [0, 0, 0, 0, 0, 0, 0]),
    );
    expect(result).toEqual({
      level: 'low',
      reasons: [
        'Tasa de check-in del 95 %',
        'Actualizaste tus mesas a mano en 0 de 7 días',
      ],
    });
  });
});
