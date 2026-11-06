// Fuente única de las columnas de cada CSV: de aquí salen la cabecera, el
// orden de las filas y el diccionario del LEEME.
export interface ColumnSpec {
  name: string;
  description: string;
}

export const RESERVATION_COLUMNS: readonly ColumnSpec[] = [
  { name: 'reservation_id', description: 'UUID de la reserva.' },
  {
    name: 'diner_pseudonym',
    description:
      'Seudónimo del comensal: 16 caracteres hexadecimales (HMAC-SHA256 con una sal aleatoria de esta exportación). Sirve para agrupar reservas del mismo comensal dentro de este CSV, nada más.',
  },
  { name: 'restaurant_id', description: 'UUID del restaurante.' },
  {
    name: 'restaurant_category',
    description:
      'Categoría del restaurante (colombian, italian, mexican, asian, grill, fast_food, healthy, seafood, cafe, other); vacío si no tiene.',
  },
  {
    name: 'table_capacity',
    description: 'Capacidad de la mesa asignada (personas).',
  },
  { name: 'party_size', description: 'Personas de la reserva (1 a 20).' },
  { name: 'status', description: 'active, cancelled, expired o completed.' },
  { name: 'created_at', description: 'Cuándo se creó (ISO 8601 UTC).' },
  {
    name: 'expires_at',
    description: 'Cuándo vence la reserva (ISO 8601 UTC).',
  },
  {
    name: 'expired_at',
    description:
      'Cuándo se marcó como vencida (ISO 8601 UTC); vacío si no venció. Puede ser posterior a expires_at: se marca cuando alguien la lee o corre el barrido.',
  },
  {
    name: 'cancelled_at',
    description: 'Cuándo se canceló (ISO 8601 UTC); vacío si no se canceló.',
  },
  {
    name: 'checked_in_at',
    description:
      'Cuándo el restaurante hizo el check-in (ISO 8601 UTC); vacío si no hubo.',
  },
  {
    name: 'no_show',
    description: 'true si venció sin que el comensal llegara; si no, false.',
  },
  {
    name: 'day_of_week',
    description:
      'Día de la semana de created_at en hora de Bogotá: 1 = lunes ... 7 = domingo.',
  },
  {
    name: 'hour_of_day',
    description: 'Hora (0 a 23) de created_at en hora de Bogotá.',
  },
  {
    name: 'seconds_to_expire_or_resolve',
    description:
      'Segundos entre created_at y el cierre de la reserva (cancelled_at, expired_at o checked_in_at). Vacío mientras sigue activa.',
  },
];

export const CHECK_IN_COLUMNS: readonly ColumnSpec[] = [
  { name: 'check_in_id', description: 'UUID del check-in.' },
  {
    name: 'reservation_id',
    description: 'UUID de la reserva (reservations.csv).',
  },
  { name: 'restaurant_id', description: 'UUID del restaurante.' },
  {
    name: 'checked_in_at',
    description: 'Cuándo se hizo el check-in (ISO 8601 UTC).',
  },
  {
    name: 'day_of_week',
    description:
      'Día de checked_in_at en hora de Bogotá: 1 = lunes ... 7 = domingo.',
  },
  {
    name: 'hour_of_day',
    description: 'Hora (0 a 23) de checked_in_at en hora de Bogotá.',
  },
];

export const TABLE_LOG_COLUMNS: readonly ColumnSpec[] = [
  { name: 'log_id', description: 'UUID del registro de la bitácora.' },
  {
    name: 'restaurant_id',
    description: 'UUID del restaurante dueño de la mesa.',
  },
  { name: 'table_id', description: 'UUID de la mesa.' },
  {
    name: 'previous_status',
    description: 'Estado anterior: available, reserved, occupied o inactive.',
  },
  {
    name: 'new_status',
    description: 'Estado nuevo: available, reserved, occupied o inactive.',
  },
  {
    name: 'source',
    description:
      'Origen del cambio: manual (el restaurante), reservation (una microreserva) o system (vencimiento automático).',
  },
  {
    name: 'changed_at',
    description: 'Cuándo ocurrió el cambio (ISO 8601 UTC).',
  },
  {
    name: 'actor_type',
    description:
      'Quién lo hizo, solo el tipo: restaurant_admin, diner o system (sin usuario). Nunca el id ni el correo.',
  },
];

export const columnNames = (columns: readonly ColumnSpec[]): string[] =>
  columns.map((column) => column.name);
