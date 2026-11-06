import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  RESERVATION_CODE_ALPHABET,
  RESERVATION_CODE_LENGTH,
} from './reservation.constants.js';

// Generador del código de la reserva (§12.1), detrás de una clase abstracta
// para reemplazarlo en las pruebas (por ejemplo, para forzar un código repetido).
export abstract class CodeGenerator {
  abstract generate(): string;
}

// crypto.randomInt, no Math.random: el código es lo que comprueba el check-in,
// así que no puede ser predecible.
@Injectable()
export class RandomCodeGenerator extends CodeGenerator {
  generate(): string {
    let code = '';
    for (let i = 0; i < RESERVATION_CODE_LENGTH; i++) {
      code +=
        RESERVATION_CODE_ALPHABET[randomInt(RESERVATION_CODE_ALPHABET.length)];
    }
    return code;
  }
}
