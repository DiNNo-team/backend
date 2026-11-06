import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { UsersService } from '../../identity-access/index.js';
import type { Reservation } from '../reservations/reservation.entity.js';

// La mesa se lee por nombre de entidad (es de restaurant-operations).
interface TableRow {
  id: string;
  identifier: string;
}

export type LabelledReservation = Pick<
  Reservation,
  'id' | 'tableId' | 'dinerId'
>;

// Lo que el restaurante ve de una reserva, además de sus propios datos.
export interface ReservationLabel {
  tableIdentifier: string;
  dinerName: string | null;
}

export type ReservationLabelOf = (
  reservation: LabelledReservation,
) => ReservationLabel;

// Identificador de la mesa y nombre del comensal de varias reservas, con una
// consulta para cada cosa (sin N+1). Lo usan el check-in y la lista. El nombre es
// el público: null si no hay o si es la parte del correo antes de @; nunca se
// arma con el correo.
@Injectable()
export class ReservationLabelsReader {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  async read(reservations: LabelledReservation[]): Promise<ReservationLabelOf> {
    const [tables, dinerNames] = await Promise.all([
      this.dataSource.getRepository<TableRow>('Table').find({
        where: { id: In([...new Set(reservations.map((r) => r.tableId))]) },
        select: { id: true, identifier: true },
      }),
      this.users.findPublicDisplayNamesByIds(
        reservations.map((r) => r.dinerId),
      ),
    ]);
    const identifiers = new Map(tables.map((t) => [t.id, t.identifier]));
    return (reservation) => {
      const tableIdentifier = identifiers.get(reservation.tableId);
      // La FK de reservations garantiza que la mesa existe.
      if (tableIdentifier === undefined) {
        throw new Error(
          `La reserva ${reservation.id} apunta a una mesa que no existe.`,
        );
      }
      return {
        tableIdentifier,
        dinerName: dinerNames.get(reservation.dinerId) ?? null,
      };
    };
  }
}
