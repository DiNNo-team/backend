import { Injectable } from '@nestjs/common';

// Source of the current instant, so the tests can fix the time.
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
