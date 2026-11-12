import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ReservationFacts } from './reservation-messages.js';

interface FactsRow {
  dinerId: string;
  restaurantName: string;
  tableIdentifier: string;
  expiresAt: Date;
}

// Read only, after the commit: the reservation with its restaurant and table,
// which belong to other modules. One query; a reservation that no longer
// exists gives null.
@Injectable()
export class ReservationFactsReader {
  constructor(private readonly dataSource: DataSource) {}

  async read(reservationId: string): Promise<ReservationFacts | null> {
    const rows: FactsRow[] = await this.dataSource.query(
      `SELECT r."diner_id" AS "dinerId", rt."name" AS "restaurantName",
              t."identifier" AS "tableIdentifier", r."expires_at" AS "expiresAt"
         FROM "reservations" r
         JOIN "restaurants" rt ON rt."id" = r."restaurant_id"
         JOIN "tables" t ON t."id" = r."table_id"
        WHERE r."id" = $1`,
      [reservationId],
    );
    const row = rows[0];
    if (!row) return null;
    return { reservationId, ...row, expiresAt: new Date(row.expiresAt) };
  }
}
