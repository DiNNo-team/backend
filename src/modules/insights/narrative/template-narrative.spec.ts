import {
  enoughMetrics,
  insufficientMetrics,
} from '../../../../test/support/insights-data.js';
import { formatHour, templateNarrative } from './template-narrative.js';

describe('templateNarrative', () => {
  it('con datos insuficientes dice cuántas resueltas faltan, sin tasas', () => {
    expect(templateNarrative(insufficientMetrics())).toBe(
      'Aún no hay suficientes reservas para tu informe. Vuelve cuando tengas al menos 10 reservas resueltas (con check-in, canceladas o vencidas); en los últimos 7 días llevas 4.',
    );
  });

  it('prioriza las vencidas sin check-in y las mesas sin actualizar, máximo 3 recomendaciones', () => {
    const text = templateNarrative(
      enoughMetrics(
        {
          checkInRate: 0.45,
          noShowRate: 0.3,
          cancellationRate: 0.25,
          expired: 12,
          cancelled: 10,
        },
        [0, 0, 0, 0, 1, 1, 1],
      ),
    );

    expect(text).toBe(
      'El 30 % de tus reservas resueltas venció sin check-in (12 de 40). Revisa si validas el código cuando llega el comensal: si no lo validas, la reserva cuenta como vencida. ' +
        'No actualizaste tus mesas a mano en 4 de 7 días. Márcalas como Ocupada o Disponible cuando cambien, para que los comensales vean tu disponibilidad real. ' +
        'El 25 % de tus reservas resueltas se canceló (10 de 40). Revisa en la bitácora a qué horas pasa.',
    );
  });

  it('con buen check-in lo reconoce y menciona la franja con más reservas', () => {
    const text = templateNarrative(
      enoughMetrics({
        checkInRate: 0.8,
        noShowRate: 0.1,
        cancellationRate: 0.1,
      }),
    );

    expect(text).toBe(
      'El 80 % de tus reservas resueltas terminó en check-in. Sigue validando el código al recibir a cada comensal. ' +
        'Tu franja con más reservas es el viernes a las 13:00 (6 reservas). Procura tener mesas Disponibles a esa hora.',
    );
  });

  it('nunca queda vacío con datos suficientes', () => {
    const text = templateNarrative(
      enoughMetrics({
        checkInRate: 0.6,
        noShowRate: 0.2,
        cancellationRate: 0.2,
      }),
    );
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('formatHour', () => {
  it('hora de 24 horas con dos dígitos', () => {
    expect(formatHour(9)).toBe('09:00');
    expect(formatHour(20)).toBe('20:00');
  });
});
