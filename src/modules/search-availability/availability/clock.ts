// Clock vive en src/common/time (lo usan también restaurant-operations y
// reservations-checkin). Re-export para no cambiar los imports existentes: es el
// mismo token, así que .overrideProvider(Clock) sigue valiendo para todos.
export { Clock, SystemClock } from '../../../common/time/clock.js';
