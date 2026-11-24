import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityManager } from 'typeorm';
import { AfterCommitEvents } from '../../../common/events/after-commit-events.js';
import {
  recordTableChange,
  type TableStatusChange,
  type TableStatusLog,
} from './table-status-log.js';

const RESTAURANT_ID = '55bb0482-be1e-490b-9ba8-7533335d958b';
const TABLE_ID = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const change: TableStatusChange = {
  tableId: TABLE_ID,
  previousStatus: 'available',
  newStatus: 'inactive',
  userId: null,
  source: 'system',
  changedAt: new Date('2026-11-06T17:00:00Z'),
};
const manager = {} as EntityManager;

// Todos los archivos .ts de producción de src/, sin pruebas.
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('recordTableChange', () => {
  it('escribe la fila con el manager recibido y deja UN table.status_changed con sus mismos valores', async () => {
    const record = vi.fn(() => Promise.resolve());
    const add = vi.spyOn(AfterCommitEvents.prototype, 'add');
    const afterCommit = new AfterCommitEvents();

    await recordTableChange(
      { record } as unknown as TableStatusLog,
      RESTAURANT_ID,
      change,
      manager,
      afterCommit,
    );

    expect(record).toHaveBeenCalledWith(change, manager);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('table.status-changed', {
      restaurantId: RESTAURANT_ID,
      tableId: TABLE_ID,
      previousStatus: 'available',
      status: 'inactive',
      source: 'system',
    });
    add.mockRestore();
  });

  it('si la fila no se pudo escribir, no deja evento y el error se propaga (rollback)', async () => {
    const add = vi.spyOn(AfterCommitEvents.prototype, 'add');

    await expect(
      recordTableChange(
        {
          record: () => Promise.reject(new Error('log roto')),
        } as unknown as TableStatusLog,
        RESTAURANT_ID,
        change,
        manager,
        new AfterCommitEvents(),
      ),
    ).rejects.toThrow('log roto');

    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  // La garantía de "una fila, un evento": toda fila nueva de bitácora pasa por
  // recordTableChange. Quien llame a .record( directo perdería el evento.
  it('es el único lugar de producción que llama a statusLog.record', () => {
    const callers = sourceFiles(join(process.cwd(), 'src'))
      .filter((path) =>
        /\b(statusLog|tableStatusLog)\??\.record\(/i.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => path.replaceAll('\\', '/').split('/src/')[1]);

    expect(callers).toEqual([
      'modules/restaurant-operations/tables/table-status-log.ts',
    ]);
  });
});
