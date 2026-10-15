import { Between, type DataSource } from 'typeorm';
import {
  RestaurantCandidatesReader,
  toCandidate,
  type CandidateRow,
} from './restaurant-candidates.reader.js';

const ROW: CandidateRow = {
  id: 'a4765bce-fc28-496c-bdbc-68bd1599f1d9',
  name: 'Casa 72',
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  latitude: 4.655671,
  longitude: -74.057006,
};

const EXPECTED = {
  id: ROW.id,
  name: 'Casa 72',
  category: 'colombian',
  address: 'Av. Calle 72 con Cra. 9, Chapinero, Bogotá',
  location: { latitude: 4.655671, longitude: -74.057006 },
};

describe('toCandidate', () => {
  it('maps a row with numeric coordinates', () => {
    expect(toCandidate(ROW)).toEqual(EXPECTED);
  });

  it('turns the numeric text of pg into numbers', () => {
    expect(
      toCandidate({ ...ROW, latitude: '4.655671', longitude: '-74.057006' }),
    ).toEqual(EXPECTED);
  });

  it('keeps a null category and address (restaurants before PBI 3)', () => {
    expect(toCandidate({ ...ROW, category: null, address: null })).toEqual({
      ...EXPECTED,
      category: null,
      address: null,
    });
  });
});

describe('RestaurantCandidatesReader', () => {
  it('reads Restaurant by entity name, only inside the rectangle and only the columns it needs', async () => {
    const find = vi.fn().mockResolvedValue([ROW]);
    const getRepository = vi.fn().mockReturnValue({ find });
    const reader = new RestaurantCandidatesReader({
      getRepository,
    } as unknown as DataSource);

    const candidates = await reader.findWithin({
      minLat: 4.64,
      maxLat: 4.67,
      minLng: -74.07,
      maxLng: -74.04,
    });

    expect(getRepository).toHaveBeenCalledWith('Restaurant');
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      where: {
        latitude: Between(4.64, 4.67),
        longitude: Between(-74.07, -74.04),
      },
      select: {
        id: true,
        name: true,
        category: true,
        address: true,
        latitude: true,
        longitude: true,
      },
    });
    expect(candidates).toEqual([EXPECTED]);
  });

  describe('category filter', () => {
    function readerWith(rows: CandidateRow[]) {
      const find = vi.fn().mockResolvedValue(rows);
      const reader = new RestaurantCandidatesReader({
        getRepository: () => ({ find }),
      } as unknown as DataSource);
      return { reader, find };
    }
    const BOX = { minLat: 4.64, maxLat: 4.67, minLng: -74.07, maxLng: -74.04 };

    it('adds the category equality to the same query', async () => {
      const { reader, find } = readerWith([ROW]);

      await reader.findWithin(BOX, { category: 'colombian' });

      expect(find).toHaveBeenCalledTimes(1);
      expect(find.mock.calls[0][0].where).toEqual({
        latitude: Between(4.64, 4.67),
        longitude: Between(-74.07, -74.04),
        category: 'colombian',
      });
    });

    it.each([
      ['no filters', undefined],
      ['an undefined category', { category: undefined }],
    ])(
      'leaves the category out of the query with %s',
      async (_case, filters) => {
        const { reader, find } = readerWith([ROW]);

        await reader.findWithin(BOX, filters);

        expect(find.mock.calls[0][0].where).not.toHaveProperty('category');
      },
    );
  });
});
