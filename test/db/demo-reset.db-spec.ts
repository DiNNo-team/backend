import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { type DemoResetFlags } from '../../src/scripts/demo-reset/flags.js';
import type { InitialTable } from '../../src/scripts/demo-reset/plan.js';
import {
  DemoResetError,
  type DemoResetIo,
  type DemoResetTarget,
  runDemoReset,
} from '../../src/scripts/demo-reset/run-demo-reset.js';
import {
  closeTestDataSource,
  openTestDataSource,
  type Scenario,
  withScenario,
} from './support/scenario.js';
import {
  insertAdmin,
  insertCheckIn,
  insertReservation,
  insertTableLog,
} from './support/script-data.js';

// demo:reset contra Postgres REAL con commits (sin ROLLBACK, igual que las
// suites de reservas). NUNCA toca Casa 72: la lógica recibe el nombre del
// restaurante y el estado inicial, y cada prueba usa su PROPIO restaurante
// "Demo Reset Test <uuid>" más uno de control.
let dataSource: DataSource;

beforeAll(async () => {
  dataSource = await openTestDataSource();
});

afterAll(async () => {
  await closeTestDataSource(dataSource);
});

const DATABASE = { host: 'host-de-prueba', database: 'base-de-prueba' };

const INITIAL: InitialTable[] = [
  { identifier: 'A1', capacity: 2, status: 'available', isActive: true },
  { identifier: 'A2', capacity: 4, status: 'available', isActive: true },
  { identifier: 'A3', capacity: 6, status: 'available', isActive: false },
  { identifier: 'A4', capacity: 2, status: 'available', isActive: true },
];

const flags = (overrides: Partial<DemoResetFlags> = {}): DemoResetFlags => ({
  apply: false,
  purgeHistory: false,
  confirm: null,
  ...overrides,
});

function capture(): DemoResetIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (message) => lines.push(message),
    askConfirmation: async () => null,
  };
}

interface Fixture {
  scenario: Scenario;
  control: Scenario;
  name: string;
  target: DemoResetTarget;
  diner: string;
  admin: string;
  reservationId: string;
}

// Restaurante propio con una mesa en cada situación y una reserva activa:
//  A1 reserved (la reserva activa)   → debe quedar available
//  A2 occupied a mano                → debe quedar available
//  A3 available y activa             → debe quedar inactiva
//  A4 ya igual al estado inicial     → no se toca
async function withFixture(
  work: (fixture: Fixture) => Promise<void>,
  initial: readonly InitialTable[] = INITIAL,
): Promise<void> {
  await withScenario(
    dataSource,
    [
      { identifier: 'A1', capacity: 2, status: 'reserved' },
      { identifier: 'A2', capacity: 4, status: 'occupied' },
      { identifier: 'A3', capacity: 6 },
      { identifier: 'A4', capacity: 2 },
    ],
    1,
    (scenario) =>
      withScenario(
        dataSource,
        [{ identifier: 'A1', capacity: 2, status: 'occupied' }],
        1,
        async (control) => {
          const name = `Demo Reset Test ${randomUUID()}`;
          await dataSource.query(
            `UPDATE restaurants SET name = $2 WHERE id = $1`,
            [scenario.restaurantId, name],
          );
          const admin = await insertAdmin(dataSource, scenario);
          const reservation = await insertReservation(dataSource, scenario, {
            dinerId: scenario.dinerIds[0],
            tableId: scenario.tableIds.get('A1')!,
            state: 'active',
          });
          await work({
            scenario,
            control,
            name,
            target: { restaurantName: name, initialTables: initial },
            diner: scenario.dinerIds[0],
            admin: admin.id,
            reservationId: reservation.id,
          });
        },
      ),
  );
}

// Todo lo que demo:reset podría tocar de un restaurante, en un valor
// comparable.
async function snapshot(restaurantId: string) {
  const tables = await dataSource.query(
    `SELECT identifier, capacity, status, is_active FROM tables WHERE restaurant_id = $1 ORDER BY identifier`,
    [restaurantId],
  );
  const reservations = await dataSource.query(
    `SELECT id, status, cancelled_at FROM reservations WHERE restaurant_id = $1 ORDER BY id`,
    [restaurantId],
  );
  const checkIns = await dataSource.query(
    `SELECT id FROM check_ins WHERE restaurant_id = $1 ORDER BY id`,
    [restaurantId],
  );
  const logs = await dataSource.query(
    `SELECT l.id, l.source FROM table_logs l JOIN tables t ON t.id = l.table_id WHERE t.restaurant_id = $1 ORDER BY l.id`,
    [restaurantId],
  );
  const restaurant = await dataSource.query(
    `SELECT name, is_open FROM restaurants WHERE id = $1`,
    [restaurantId],
  );
  return { tables, reservations, checkIns, logs, restaurant };
}

async function systemLogs(restaurantId: string) {
  return dataSource.query<
    {
      identifier: string;
      previous_status: string;
      new_status: string;
      user_id: string | null;
    }[]
  >(
    `SELECT t.identifier, l.previous_status, l.new_status, l.user_id
       FROM table_logs l JOIN tables t ON t.id = l.table_id
      WHERE t.restaurant_id = $1 AND l.source = 'system'
      ORDER BY t.identifier, l.changed_at`,
    [restaurantId],
  );
}

const run = (
  fixture: Fixture,
  runFlags: DemoResetFlags,
  io: DemoResetIo = capture(),
) =>
  runDemoReset(dataSource, fixture.target, DATABASE, runFlags, io, new Date());

describe('demo:reset', () => {
  it('dry-run (por defecto) muestra el resumen y no escribe nada', async () => {
    await withFixture(async (fixture) => {
      const before = await snapshot(fixture.scenario.restaurantId);
      const io = capture();
      const outcome = await run(fixture, flags(), io);

      expect(outcome.kind).toBe('dry-run');
      expect(await snapshot(fixture.scenario.restaurantId)).toEqual(before);
      const text = io.lines.join('\n');
      expect(text).toContain(DATABASE.database);
      expect(text).toContain(DATABASE.host);
      expect(text).toContain(fixture.name);
      expect(text).toContain('cancelar 1 reservas activas');
      expect(text).toContain('A1');
      expect(text).toContain('DRY-RUN');
    });
  });

  it('--apply sin confirmación y con confirmación incorrecta abortan sin escribir', async () => {
    await withFixture(async (fixture) => {
      const before = await snapshot(fixture.scenario.restaurantId);
      const noConfirmation = await run(fixture, flags({ apply: true }));
      const wrong = await run(
        fixture,
        flags({ apply: true, confirm: 'otra-base' }),
      );
      expect(noConfirmation.kind).toBe('aborted');
      expect(wrong.kind).toBe('aborted');
      expect(await snapshot(fixture.scenario.restaurantId)).toEqual(before);
    });
  });

  it('con la confirmación correcta cancela las activas, restaura las mesas y escribe bitácora system solo de las que cambiaron', async () => {
    await withFixture(async (fixture) => {
      const controlBefore = await snapshot(fixture.control.restaurantId);
      const outcome = await run(
        fixture,
        flags({ apply: true, confirm: DATABASE.database }),
      );
      expect(outcome.kind).toBe('applied');

      // La reserva sigue ahí, cancelada y con su fecha; no se escribió check_ins.
      const reservations = await dataSource.query<
        { id: string; status: string; cancelled_at: Date | null }[]
      >(
        `SELECT id, status, cancelled_at FROM reservations WHERE restaurant_id = $1`,
        [fixture.scenario.restaurantId],
      );
      expect(reservations).toHaveLength(1);
      expect(reservations[0].id).toBe(fixture.reservationId);
      expect(reservations[0].status).toBe('cancelled');
      expect(reservations[0].cancelled_at).toBeInstanceOf(Date);
      expect(
        await dataSource.query(
          `SELECT 1 FROM check_ins WHERE restaurant_id = $1`,
          [fixture.scenario.restaurantId],
        ),
      ).toHaveLength(0);

      // Mesas en su estado inicial.
      const tables = await dataSource.query(
        `SELECT identifier, capacity, status, is_active FROM tables WHERE restaurant_id = $1 ORDER BY identifier`,
        [fixture.scenario.restaurantId],
      );
      expect(tables).toEqual([
        { identifier: 'A1', capacity: 2, status: 'available', is_active: true },
        { identifier: 'A2', capacity: 4, status: 'available', is_active: true },
        {
          identifier: 'A3',
          capacity: 6,
          status: 'available',
          is_active: false,
        },
        { identifier: 'A4', capacity: 2, status: 'available', is_active: true },
      ]);

      // Bitácora 'system', sin usuario, solo de las mesas que cambiaron.
      expect(await systemLogs(fixture.scenario.restaurantId)).toEqual([
        {
          identifier: 'A1',
          previous_status: 'reserved',
          new_status: 'available',
          user_id: null,
        },
        {
          identifier: 'A2',
          previous_status: 'occupied',
          new_status: 'available',
          user_id: null,
        },
        {
          identifier: 'A3',
          previous_status: 'available',
          new_status: 'inactive',
          user_id: null,
        },
      ]);

      // El restaurante de control no se tocó.
      expect(await snapshot(fixture.control.restaurantId)).toEqual(
        controlBefore,
      );
    });
  });

  it('es idempotente: la segunda corrida no cambia nada', async () => {
    await withFixture(async (fixture) => {
      const confirmed = flags({ apply: true, confirm: DATABASE.database });
      await run(fixture, confirmed);
      const after = await snapshot(fixture.scenario.restaurantId);

      const second = await run(fixture, confirmed);
      expect(second.kind).toBe('applied');
      if (second.kind === 'applied') {
        expect(second.summary.tableChanges).toEqual([]);
        expect(second.summary.activeReservations).toBe(0);
      }
      expect(await snapshot(fixture.scenario.restaurantId)).toEqual(after);
    });
  });

  it('--purge-history borra check_ins, reservas y la bitácora reservation/system, y deja las manual', async () => {
    await withFixture(async (fixture) => {
      const { scenario, control } = fixture;
      const tableA2 = scenario.tableIds.get('A2')!;
      const completed = await insertReservation(dataSource, scenario, {
        dinerId: fixture.diner,
        tableId: tableA2,
        state: 'completed',
      });
      await insertCheckIn(dataSource, scenario, completed.id);
      await insertTableLog(dataSource, tableA2, {
        previous: 'available',
        next: 'occupied',
        source: 'manual',
        userId: fixture.admin,
      });
      await insertTableLog(dataSource, tableA2, {
        previous: 'available',
        next: 'reserved',
        source: 'reservation',
        userId: fixture.diner,
      });
      await insertTableLog(dataSource, tableA2, {
        previous: 'reserved',
        next: 'available',
        source: 'system',
        userId: null,
      });
      // El control tiene su propio historial: no se toca.
      const controlTable = control.tableIds.get('A1')!;
      const controlReservation = await insertReservation(dataSource, control, {
        dinerId: control.dinerIds[0],
        tableId: controlTable,
        state: 'completed',
      });
      await insertCheckIn(dataSource, control, controlReservation.id);
      await insertTableLog(dataSource, controlTable, {
        previous: 'available',
        next: 'reserved',
        source: 'reservation',
        userId: control.dinerIds[0],
      });
      const controlBefore = await snapshot(control.restaurantId);

      // El dry-run con la purga dice cuántas filas borraría y no borra nada.
      const io = capture();
      const dry = await run(fixture, flags({ purgeHistory: true }), io);
      expect(dry.kind).toBe('dry-run');
      if (dry.kind === 'dry-run') {
        expect(dry.summary.purge).toEqual({
          checkIns: 1,
          reservations: 2,
          tableLogs: 2,
        });
      }
      expect(io.lines.join('\n')).toContain(
        'borrar 1 check-ins, 2 reservas (1 activas) y 2 filas de bitácora',
      );
      expect(
        await dataSource.query(
          `SELECT 1 FROM reservations WHERE restaurant_id = $1`,
          [scenario.restaurantId],
        ),
      ).toHaveLength(2);

      await run(
        fixture,
        flags({ apply: true, purgeHistory: true, confirm: DATABASE.database }),
      );

      const after = await snapshot(scenario.restaurantId);
      expect(after.checkIns).toEqual([]);
      expect(after.reservations).toEqual([]);
      // Quedan la manual y las 'system' que escribió este reset; ninguna
      // 'reservation' ni las 'system' anteriores.
      const sources = after.logs.map((log: { source: string }) => log.source);
      expect(
        sources.filter((source: string) => source === 'manual'),
      ).toHaveLength(1);
      expect(sources).not.toContain('reservation');
      expect(await systemLogs(scenario.restaurantId)).toHaveLength(3);
      expect(await snapshot(control.restaurantId)).toEqual(controlBefore);
    });
  });

  it('un fallo a mitad hace rollback completo', async () => {
    // A2 pide un estado que el check de la base rechaza: A1 y la cancelación ya
    // se habían escrito en la transacción.
    const broken: InitialTable[] = [
      INITIAL[0],
      { ...INITIAL[1], status: 'bogus' as never },
      INITIAL[2],
      INITIAL[3],
    ];
    await withFixture(async (fixture) => {
      const before = await snapshot(fixture.scenario.restaurantId);
      await expect(
        run(fixture, flags({ apply: true, confirm: DATABASE.database })),
      ).rejects.toThrow();
      expect(await snapshot(fixture.scenario.restaurantId)).toEqual(before);
    }, broken);
  });

  it('un nombre que no existe aborta con un mensaje claro', async () => {
    await withFixture(async (fixture) => {
      const target = {
        ...fixture.target,
        restaurantName: `No Existe ${randomUUID()}`,
      };
      await expect(
        runDemoReset(
          dataSource,
          target,
          DATABASE,
          flags({ apply: true, confirm: DATABASE.database }),
          capture(),
        ),
      ).rejects.toThrow(DemoResetError);
    });
  });

  it('un nombre duplicado aborta y no toca ninguno', async () => {
    await withFixture(async (fixture) => {
      await dataSource.query(`UPDATE restaurants SET name = $2 WHERE id = $1`, [
        fixture.control.restaurantId,
        fixture.name,
      ]);
      const before = await snapshot(fixture.scenario.restaurantId);
      await expect(
        run(fixture, flags({ apply: true, confirm: DATABASE.database })),
      ).rejects.toThrow(/2 restaurantes/);
      expect(await snapshot(fixture.scenario.restaurantId)).toEqual(before);
    });
  });
});
