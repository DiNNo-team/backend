import {
  enoughMetrics,
  insufficientMetrics,
  previousMetrics,
} from '../../../../test/support/insights-data.js';
import { reliabilityOf } from '../reliability/reliability.js';
import {
  llmUserMessage,
  NARRATIVE_SYSTEM_PROMPT,
  narrativePlaceholders,
  renderNarrative,
} from './llm-prompt.js';

describe('narrativePlaceholders', () => {
  const metrics = enoughMetrics();
  const placeholders = narrativePlaceholders(
    metrics,
    reliabilityOf(metrics),
    previousMetrics(),
  );
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
      promedio_personas_por_reserva: '2,8',
      dias_sin_cambios_manuales_nombres: 'viernes',
      nivel_check_in: 'medio',
      nivel_cancelaciones: 'normal',
      nivel_vencidas_sin_check_in: 'normal',
      reservas_creadas_semana_anterior: '35',
      cambio_reservas_creadas: 'subió',
      porcentaje_con_check_in_semana_anterior: '55 %',
      cambio_porcentaje_con_check_in: 'subió',
      confiabilidad_de_la_disponibilidad: 'media',
    });
  });

  const valuesOf = (
    overrides: Parameters<typeof enoughMetrics>[0],
    manualUpdates?: number[],
    previous = previousMetrics(),
  ) => {
    const changed = enoughMetrics(overrides, manualUpdates);
    return Object.fromEntries(
      Object.entries(
        narrativePlaceholders(changed, reliabilityOf(changed), previous),
      ).map(([key, { value }]) => [key, value]),
    );
  };

  it('el nivel de cada tasa lo decide el backend con las reglas del indicador y de las plantillas', () => {
    expect(
      valuesOf({ checkInRate: 0.7, cancellationRate: 0.25, noShowRate: 0.3 }),
    ).toMatchObject({
      nivel_check_in: 'alto',
      nivel_cancelaciones: 'alto',
      nivel_vencidas_sin_check_in: 'alto',
    });
    expect(valuesOf({ checkInRate: 0.39 })).toMatchObject({
      nivel_check_in: 'bajo',
    });
  });

  it('dice si la semana mejoró, empeoró o se mantuvo', () => {
    expect(
      valuesOf(
        {},
        undefined,
        previousMetrics({ reservationsCreated: 50, checkInRate: 0.8 }),
      ),
    ).toMatchObject({
      cambio_reservas_creadas: 'bajó',
      cambio_porcentaje_con_check_in: 'bajó',
    });
    // 0.651 y 0.65 se muestran los dos como 65 %: no es un cambio.
    expect(
      valuesOf(
        {},
        undefined,
        previousMetrics({ reservationsCreated: 42, checkInRate: 0.651 }),
      ),
    ).toMatchObject({
      cambio_reservas_creadas: 'se mantuvo igual',
      cambio_porcentaje_con_check_in: 'se mantuvo igual',
    });
  });

  it('sin tasa de la semana anterior no compara el check-in', () => {
    const values = valuesOf(
      {},
      undefined,
      previousMetrics({ resolved: 4, checkInRate: null }),
    );
    expect(values).toHaveProperty('cambio_reservas_creadas');
    expect(values).not.toHaveProperty(
      'porcentaje_con_check_in_semana_anterior',
    );
    expect(values).not.toHaveProperty('cambio_porcentaje_con_check_in');
  });

  it('nombra los días sin cambios manuales de lunes a domingo, solo si hubo algunos', () => {
    // 11 (miércoles), 13 (viernes) y 16 (lunes) de noviembre sin cambios.
    expect(valuesOf({}, [0, 4, 0, 5, 2, 0, 4])).toMatchObject({
      dias_sin_cambios_manuales_nombres: 'lunes, miércoles y viernes',
    });
    expect(valuesOf({}, [1, 1, 1, 1, 1, 1, 1])).not.toHaveProperty(
      'dias_sin_cambios_manuales_nombres',
    );
    expect(valuesOf({}, [0, 0, 0, 0, 0, 0, 0])).not.toHaveProperty(
      'dias_sin_cambios_manuales_nombres',
    );
  });

  it('sin promedio de personas no ofrece esa clave', () => {
    expect(valuesOf({ averagePartySize: null })).not.toHaveProperty(
      'promedio_personas_por_reserva',
    );
  });

  it('ningún valor lleva una fecha ni un id', () => {
    const all = Object.values(valuesOf({})).join(' ');
    expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('sin mediana ni franjas no ofrece esas claves', () => {
    const without = enoughMetrics({
      medianMinutesToCheckIn: null,
      topSlots: [],
    });
    const keys = Object.keys(
      narrativePlaceholders(without, reliabilityOf(without), previousMetrics()),
    );
    expect(keys).not.toContain('mediana_minutos_hasta_check_in');
    expect(keys.some((key) => key.startsWith('franja_'))).toBe(false);
  });

  it('sin nivel de confiabilidad no ofrece esa clave', () => {
    const few = insufficientMetrics();
    expect(
      Object.keys(
        narrativePlaceholders(few, reliabilityOf(few), previousMetrics()),
      ),
    ).not.toContain('confiabilidad_de_la_disponibilidad');
  });
});

describe('NARRATIVE_SYSTEM_PROMPT', () => {
  it('pide acciones de DiNNo, reconocer lo bueno y evitar lo genérico', () => {
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      'acción concreta que el restaurante pueda hacer en DiNNo',
    );
    expect(NARRATIVE_SYSTEM_PROMPT).toContain(
      'reconócelo y di cómo mantenerlo',
    );
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('No des consejos genéricos');
    expect(NARRATIVE_SYSTEM_PROMPT).toContain('nivel_');
  });
});

describe('llmUserMessage', () => {
  const metrics = enoughMetrics();
  const message = llmUserMessage(
    narrativePlaceholders(metrics, reliabilityOf(metrics), previousMetrics()),
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
  const placeholders = narrativePlaceholders(
    metrics,
    reliabilityOf(metrics),
    previousMetrics(),
  );
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
