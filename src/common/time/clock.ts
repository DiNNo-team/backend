import { Injectable } from '@nestjs/common';

// Fuente del instante actual, para que las pruebas puedan fijar la hora. Vive en
// common porque la usan varios módulos (search-availability, restaurant-operations
// y reservations-checkin) y no es de ningún dominio. Cada módulo que la necesita
// registra { provide: Clock, useClass: SystemClock }; .overrideProvider(Clock) en
// las pruebas reemplaza todas, porque el token es el mismo.
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
