import { In, type DataSource } from 'typeorm';
import type { UsersService } from '../../identity-access/index.js';
import { ReservationLabelsReader } from './reservation-labels.reader.js';

const reservation = (id: string, tableId: string, dinerId: string) => ({
  id,
  tableId,
  dinerId,
});

function setup(tables: { id: string; identifier: string }[]) {
  const tablesRepo = { find: vi.fn(() => Promise.resolve(tables)) };
  const dataSource = { getRepository: vi.fn(() => tablesRepo) };
  const users = {
    findPublicDisplayNamesByIds: vi.fn(() =>
      Promise.resolve(
        new Map<string, string | null>([
          ['d1', 'Ana'],
          ['d2', null],
        ]),
      ),
    ),
  };
  const reader = new ReservationLabelsReader(
    dataSource as unknown as DataSource,
    users as unknown as UsersService,
  );
  return { reader, dataSource, tablesRepo, users };
}

describe('ReservationLabelsReader', () => {
  it('lee mesas y nombres con una consulta para cada cosa, sin repetir ids', async () => {
    const t = setup([
      { id: 't1', identifier: '01' },
      { id: 't2', identifier: '02' },
    ]);
    const reservations = [
      reservation('r1', 't1', 'd1'),
      reservation('r2', 't2', 'd2'),
      reservation('r3', 't1', 'd1'),
    ];

    await t.reader.read(reservations);

    expect(t.dataSource.getRepository).toHaveBeenCalledWith('Table');
    expect(t.tablesRepo.find).toHaveBeenCalledTimes(1);
    expect(t.tablesRepo.find).toHaveBeenCalledWith({
      where: { id: In(['t1', 't2']) },
      select: { id: true, identifier: true },
    });
    expect(t.users.findPublicDisplayNamesByIds).toHaveBeenCalledTimes(1);
  });

  it('da el identificador y el nombre de cada reserva; el nombre puede ser null', async () => {
    const t = setup([{ id: 't1', identifier: '01' }]);
    const named = reservation('r1', 't1', 'd1');
    const unnamed = reservation('r2', 't1', 'd2');
    const unknownDiner = reservation('r3', 't1', 'd3');

    const labelOf = await t.reader.read([named, unnamed, unknownDiner]);

    expect(labelOf(named)).toEqual({ tableIdentifier: '01', dinerName: 'Ana' });
    expect(labelOf(unnamed)).toEqual({
      tableIdentifier: '01',
      dinerName: null,
    });
    expect(labelOf(unknownDiner)).toEqual({
      tableIdentifier: '01',
      dinerName: null,
    });
  });

  it('una mesa que no existe es un error interno, no un identificador inventado', async () => {
    const t = setup([]);
    const orphan = reservation('r1', 't1', 'd1');

    const labelOf = await t.reader.read([orphan]);

    expect(() => labelOf(orphan)).toThrow('apunta a una mesa que no existe');
  });
});
