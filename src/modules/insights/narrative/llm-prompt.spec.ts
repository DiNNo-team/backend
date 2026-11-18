import {
  enoughMetrics,
  insufficientMetrics,
} from '../../../../test/support/insights-data.js';
import { reliabilityOf } from '../reliability/reliability.js';
import {
  llmUserMessage,
  narrativePlaceholders,
  renderNarrative,
} from './llm-prompt.js';

describe('narrativePlaceholders', () => {
  const metrics = enoughMetrics();
  const placeholders = narrativePlaceholders(metrics, reliabilityOf(metrics));
  const values = Object.fromEntries(
    Object.entries(placeholders).map(([key, { value }]) => [key, value]),
  );

  it('cada dato con su unidad ya puesta', () => {
    expect(values).toEqual({
      dias_del_periodo: '7',
      reservas_creadas: '42',
      reservas_resueltas: '40',
      reservas_con_check_in: '26',
      reservas_vencidas_sin_check_in: '10',
      reservas_canceladas: '4',
      porcentaje_con_check_in: '65 %',
      porcentaje_vencidas_sin_check_in: '25 %',
      porcentaje_canceladas: '10 %',
      cambios_manuales_de_mesas: '24',
      dias_con_cambios_manuales: '6',
      dias_sin_cambios_manuales: '1',
      mediana_minutos_hasta_check_in: '9,5',
      franja_1_dia: 'viernes',
      franja_1_hora: '13:00',
      franja_1_reservas: '6',
      franja_2_dia: 'sábado',
      franja_2_hora: '20:00',
      franja_2_reservas: '5',
      confiabilidad_de_la_disponibilidad: 'media',
    });
  });

  it('sin mediana ni franjas no ofrece esas claves', () => {
    const without = enoughMetrics({
      medianMinutesToCheckIn: null,
      topSlots: [],
    });
    const keys = Object.keys(
      narrativePlaceholders(without, reliabilityOf(without)),
    );
    expect(keys).not.toContain('mediana_minutos_hasta_check_in');
    expect(keys.some((key) => key.startsWith('franja_'))).toBe(false);
  });

  it('sin nivel de confiabilidad no ofrece esa clave', () => {
    const few = insufficientMetrics();
    expect(
      Object.keys(narrativePlaceholders(few, reliabilityOf(few))),
    ).not.toContain('confiabilidad_de_la_disponibilidad');
  });
});

describe('llmUserMessage', () => {
  const metrics = enoughMetrics();
  const message = llmUserMessage(
    narrativePlaceholders(metrics, reliabilityOf(metrics)),
  );

  it('cada clave con su valor y su significado', () => {
    expect(JSON.parse(message)).toMatchObject({
      porcentaje_con_check_in: {
        valor: '65 %',
        significa:
          'de las reservas resueltas, qué porcentaje terminó en check-in',
      },
      cambios_manuales_de_mesas: {
        valor: '24',
        significa:
          'veces que el restaurante cambió a mano el estado de una mesa en el periodo',
      },
    });
  });

  it('no lleva ids, correos, nombres, códigos ni fechas exactas', () => {
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(message).not.toMatch(/@/);
    expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('renderNarrative', () => {
  const metrics = enoughMetrics();
  const placeholders = narrativePlaceholders(metrics, reliabilityOf(metrics));
  const render = (text: string) => renderNarrative(text, placeholders);

  it('pone cada valor con su unidad', () => {
    expect(
      render(
        'El {porcentaje_vencidas_sin_check_in} de tus reservas resueltas venció sin check-in ' +
          '({reservas_vencidas_sin_check_in} de {reservas_resueltas}). Ten mesas Disponibles el ' +
          '{franja_1_dia} a las {franja_1_hora}.',
      ),
    ).toEqual({
      ok: true,
      text:
        'El 25 % de tus reservas resueltas venció sin check-in (10 de 40). Ten mesas Disponibles ' +
        'el viernes a las 13:00.',
    });
  });

  it('un texto sin datos también sirve', () => {
    expect(render('  Valida el código cuando llegue cada comensal.  ')).toEqual(
      {
        ok: true,
        text: 'Valida el código cuando llegue cada comensal.',
      },
    );
  });

  it('descarta un número escrito por el modelo, aunque exista en las métricas', () => {
    // 24 son los cambios manuales de mesas: como porcentaje sería falso.
    expect(render('El 24 % de tus reservas terminó en check-in.')).toEqual({
      ok: false,
      problem: 'el texto escribe números o signos en vez de claves: 2 4 %',
    });
  });

  it('descarta un % escrito junto a una clave (el valor ya trae su unidad)', () => {
    expect(render('El {cambios_manuales_de_mesas} % de tus reservas…')).toEqual(
      {
        ok: false,
        problem: 'el texto escribe números o signos en vez de claves: %',
      },
    );
  });

  it('descarta una hora escrita a mano', () => {
    expect(render('Ten mesas a las 18:00.')).toMatchObject({ ok: false });
  });

  it('descarta claves que no existen y llaves sueltas', () => {
    expect(render('El {porcentaje_de_ventas} subió.')).toEqual({
      ok: false,
      problem: 'el texto usa claves que no existen: porcentaje_de_ventas',
    });
    expect(render('El {Porcentaje} subió.')).toMatchObject({ ok: false });
    expect(render('Revisa tus mesas }.')).toMatchObject({ ok: false });
  });

  it('descarta un texto vacío o de más de 600 caracteres ya con los valores puestos', () => {
    expect(render('   ')).toEqual({
      ok: false,
      problem: 'el modelo respondió vacío',
    });
    // 596 + "65 %" = 600: pasa. Uno más ya no.
    expect(render('a'.repeat(596) + '{porcentaje_con_check_in}')).toMatchObject(
      {
        ok: true,
      },
    );
    expect(render('a'.repeat(597) + '{porcentaje_con_check_in}')).toEqual({
      ok: false,
      problem: 'el texto tiene 601 caracteres (máximo 600)',
    });
  });
});
