import { createHmac, randomBytes } from 'node:crypto';

export type Pseudonymizer = (id: string) => string;

// Una sal nueva por exportación. Vive solo en memoria: no se guarda ni se
// imprime, así que los seudónimos no se pueden cruzar entre exportaciones ni
// revertir.
export function newSalt(): Buffer {
  return randomBytes(32);
}

// HMAC-SHA256 del id con la sal, truncado a 16 caracteres hexadecimales.
export function createPseudonymizer(salt: Buffer): Pseudonymizer {
  return (id) =>
    createHmac('sha256', salt).update(id).digest('hex').slice(0, 16);
}
