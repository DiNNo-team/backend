import { DataSource } from 'typeorm';
import { User } from './../../src/modules/identity-access/users/user.entity.js';
import { CheckIn } from './../../src/modules/reservations-checkin/check-ins/check-in.entity.js';
import { Reservation } from './../../src/modules/reservations-checkin/reservations/reservation.entity.js';
import { Restaurant } from './../../src/modules/restaurant-operations/restaurants/restaurant.entity.js';
import { Table } from './../../src/modules/restaurant-operations/tables/table.entity.js';

// DataSource de TypeORM con los metadatos reales de las entidades pero SIN
// conectarse a ninguna base: sirve para que las pruebas unitarias armen el SQL
// con el query builder de verdad (getQueryAndParameters) y no con un doble que
// repita lo que el código supone. Nunca llama a initialize().
export async function createMetadataOnlyDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [Reservation, CheckIn, User, Restaurant, Table],
  });
  // Protegido en la API pública; es lo que initialize() hace antes de conectar.
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource;
}
