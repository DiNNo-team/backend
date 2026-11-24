import { toBogotaTime } from '../../modules/search-availability/availability/bogota-time.js';

export interface BogotaParts {
  // 1 = lunes ... 7 = domingo, como el resto de la API.
  dayOfWeek: number;
  // 0 a 23.
  hourOfDay: number;
}

// Día y hora de un instante en el reloj de Bogotá (depende solo del instante,
// no del TZ de la máquina).
export function bogotaParts(instant: Date): BogotaParts {
  const { dayOfWeek, minuteOfDay } = toBogotaTime(instant);
  return { dayOfWeek, hourOfDay: Math.floor(minuteOfDay / 60) };
}
