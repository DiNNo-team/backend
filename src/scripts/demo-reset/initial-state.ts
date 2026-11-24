import { CASA72_NAME } from '../../seed-data/run-seed.js';
import type { InitialTable } from './plan.js';

// Estado inicial de la demo: las 8 mesas de Casa 72 Disponibles, con las
// capacidades del seed y la Mesa 8 inactiva como en el seed.
//
// DIFIERE DEL SEED A PROPÓSITO: el seed deja 2 mesas Reservada y 2 Ocupada a
// mano, sin una reserva real detrás; la demo arrancaría con 4 de 8 mesas
// bloqueadas. Si cambian las mesas del seed, este archivo se revisa aparte.
export const DEMO_RESTAURANT_NAME = CASA72_NAME;

export const DEMO_INITIAL_TABLES: readonly InitialTable[] = [
  { identifier: 'Mesa 1', capacity: 2, status: 'available', isActive: true },
  { identifier: 'Mesa 2', capacity: 2, status: 'available', isActive: true },
  { identifier: 'Mesa 3', capacity: 4, status: 'available', isActive: true },
  { identifier: 'Mesa 4', capacity: 4, status: 'available', isActive: true },
  { identifier: 'Mesa 5', capacity: 4, status: 'available', isActive: true },
  { identifier: 'Mesa 6', capacity: 6, status: 'available', isActive: true },
  { identifier: 'Mesa 7', capacity: 6, status: 'available', isActive: true },
  { identifier: 'Mesa 8', capacity: 8, status: 'available', isActive: false },
];
