import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity-access/index.js';
import { User } from '../../src/modules/identity-access/users/user.entity.js';
import { UsersService } from '../../src/modules/identity-access/users/users.service.js';
import { BillingStatementService } from '../../src/modules/reservations-checkin/billing/billing-statement.service.js';
import { CheckInService } from '../../src/modules/reservations-checkin/check-ins/check-in.service.js';
import { ReservationLabelsReader } from '../../src/modules/reservations-checkin/check-ins/reservation-labels.reader.js';
import { parseReportPeriod } from '../../src/modules/reservations-checkin/reports/report-period.js';
import { ReservationExpirationService } from '../../src/modules/reservations-checkin/reservations/reservation-expiration.service.js';
import { DbTableStatusLog } from '../../src/modules/restaurant-operations/table-logs/table-logs.recorder.js';
import type { Clock } from '../../src/modules/search-availability/index.js';
import {
  closeTestDataSource,
  openTestDataSource,
  withScenario,
} from './support/scenario.js';
import { insertAdmin, insertReservation } from './support/script-data.js';
import { CHECK_VIOLATION } from './support/test-db.js';

// Cobro por check-in (CLAUDE.md §11, "Cobro por check-in") contra Postgres REAL:
// cada check-in guarda su total (personas × tarifa por comensal vigente en ese
// momento), cambiar la tarifa no altera los anteriores y el estado de cuenta
// suma lo guardado. Commits reales:
// cada prueba borra solo lo que creó (support/scenario.ts).

const NOT_NULL_VIOLATION = '23502';
// Reloj real: las reservas de prueba vencen en 15 minutos.
const CLOCK: Clock = { now: () => new Date() };

let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

function checkInServiceWithFee(feePerGuestCop: number): CheckInService {
  const statusLog = new DbTableStatusLog();
  const events = new EventEmitter2();
  return new CheckInService(
    dataSource,
    new ReservationExpirationService(dataSource, statusLog, events, CLOCK),
    statusLog,
    new ReservationLabelsReader(
      dataSource,
      new UsersService(dataSource.getRepository(User)),
    ),
    CLOCK,
    events,
    { feePerGuestCop },
  );
}

function today() {
  const result = parseReportPeriod({}, new Date());
  if (!result.ok) throw new Error(result.errors.join());
  return result.period;
}

describe('Cobro por check-in (Postgres)', () => {
  it('cada check-in guarda personas × tarifa por comensal; cambiarla no altera los anteriores y el estado de cuenta suma lo guardado', async () => {
    await withScenario(
      dataSource,
      [
        { identifier: '01', capacity: 2 },
        { identifier: '02', capacity: 4 },
        { identifier: '03', capacity: 4 },
      ],
      3,
      async (scenario) => {
        const admin = await insertAdmin(dataSource, scenario);
        const user = {
          userId: admin.id,
          restaurantId: scenario.restaurantId,
          role: UserRole.RESTAURANT_ADMIN,
          restaurantApproval: 'approved' as const,
        };
        const reservations = await Promise.all(
          ['01', '02', '03'].map((identifier, index) =>
            insertReservation(dataSource, scenario, {
              dinerId: scenario.dinerIds[index],
              tableId: scenario.tableIds.get(identifier) as string,
              state: 'active',
              partySize: [2, 4, 5][index],
            }),
          ),
        );

        // Tres tarifas por comensal distintas, una por check-in, como si
        // CHECKIN_FEE_PER_GUEST_COP cambiara entre uno y otro.
        await checkInServiceWithFee(2000).checkIn(user, reservations[0].code);
        await checkInServiceWithFee(1500).checkIn(user, reservations[1].code);
        await checkInServiceWithFee(0).checkIn(user, reservations[2].code);

        const stored = await dataSource.query<
          { reservation_id: string; fee_cop: number }[]
        >(
          `SELECT reservation_id, fee_cop FROM check_ins WHERE restaurant_id = $1 ORDER BY checked_in_at`,
          [scenario.restaurantId],
        );
        expect(stored).toEqual([
          { reservation_id: reservations[0].id, fee_cop: 4000 },
          { reservation_id: reservations[1].id, fee_cop: 6000 },
          { reservation_id: reservations[2].id, fee_cop: 0 },
        ]);

        const billing = new BillingStatementService(dataSource);
        const period = today();
        expect(await billing.totals(scenario.restaurantId, period)).toEqual({
          checkIns: 3,
          amountCop: 10000,
        });
        const statement = await billing.statement(
          scenario.restaurantId,
          period,
          { page: 1, pageSize: 2 },
        );
        // Totales del periodo completo; la página, el más reciente primero.
        expect(statement.totalCheckIns).toBe(3);
        expect(statement.amountCop).toBe(10000);
        expect(
          statement.items.map((item) => [item.tableIdentifier, item.feeCop]),
        ).toEqual([
          ['03', 0],
          ['02', 6000],
        ]);
        const second = await billing.statement(scenario.restaurantId, period, {
          page: 2,
          pageSize: 2,
        });
        expect(second.items.map((item) => item.feeCop)).toEqual([4000]);

        // Un periodo que no incluye hoy no cuenta nada.
        const past = parseReportPeriod(
          { from: '2026-01-01', to: '2026-01-31' },
          new Date(),
        );
        if (!past.ok) throw new Error(past.errors.join());
        expect(
          await billing.totals(scenario.restaurantId, past.period),
        ).toEqual({ checkIns: 0, amountCop: 0 });
      },
    );
  });

  it('fee_cop es obligatoria (sin default) y nunca negativa', async () => {
    await withScenario(
      dataSource,
      [{ identifier: '01', capacity: 2 }],
      1,
      async (scenario) => {
        const reservation = await insertReservation(dataSource, scenario, {
          dinerId: scenario.dinerIds[0],
          tableId: scenario.tableIds.get('01') as string,
          state: 'completed',
        });
        const insert = (fee: string) =>
          dataSource
            .query(
              `INSERT INTO check_ins (reservation_id, restaurant_id, checked_in_at${fee ? ', fee_cop' : ''}) VALUES ($1, $2, now()${fee ? `, ${fee}` : ''})`,
              [reservation.id, scenario.restaurantId],
            )
            .then(
              () => null,
              (error: {
                driverError?: { code: string; constraint?: string };
              }) => error.driverError,
            );

        expect(await insert('')).toMatchObject({ code: NOT_NULL_VIOLATION });
        expect(await insert('-1')).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'CHK_check_ins_fee_cop',
        });
      },
    );
  });

  it('existe el índice (restaurant_id, checked_in_at)', async () => {
    const rows = await dataSource.query<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'check_ins' AND indexname = 'IDX_check_ins_restaurant_id_checked_in_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('(restaurant_id, checked_in_at)');
  });
});
