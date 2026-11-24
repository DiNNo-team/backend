import { bogotaParts } from './bogota-parts.js';

describe('bogotaParts', () => {
  it('cerca de la medianoche UTC, Bogotá (UTC-5) sigue en el día anterior', () => {
    // Viernes 2026-11-06 02:30 UTC = jueves 2026-11-05 21:30 en Bogotá.
    expect(bogotaParts(new Date('2026-11-06T02:30:00Z'))).toEqual({
      dayOfWeek: 4,
      hourOfDay: 21,
    });
  });

  it('las 04:59 UTC son las 23:59 del día anterior; las 05:00 UTC ya son medianoche', () => {
    expect(bogotaParts(new Date('2026-11-06T04:59:59Z'))).toEqual({
      dayOfWeek: 4,
      hourOfDay: 23,
    });
    expect(bogotaParts(new Date('2026-11-06T05:00:00Z'))).toEqual({
      dayOfWeek: 5,
      hourOfDay: 0,
    });
  });

  it('el domingo es 7', () => {
    // Domingo 2026-11-08 12:00 UTC = 07:00 en Bogotá.
    expect(bogotaParts(new Date('2026-11-08T12:00:00Z'))).toEqual({
      dayOfWeek: 7,
      hourOfDay: 7,
    });
  });
});
