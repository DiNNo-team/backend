import { scopedRange } from './scoped-range.js';

const PERIOD = {
  startsAt: new Date('2026-11-01T05:00:00Z'),
  endsBefore: new Date('2026-12-01T05:00:00Z'),
};

describe('scopedRange', () => {
  it('keeps the restaurant query text and parameters of always', () => {
    expect(scopedRange('created_at', PERIOD, 'r-1')).toEqual({
      where:
        '"restaurant_id" = $1 AND "created_at" >= $2 AND "created_at" < $3',
      params: ['r-1', PERIOD.startsAt, PERIOD.endsBefore],
    });
  });

  it('without a restaurant filters only the range (the whole platform)', () => {
    const range = scopedRange('checked_in_at', PERIOD);

    expect(range).toEqual({
      where: '"checked_in_at" >= $1 AND "checked_in_at" < $2',
      params: [PERIOD.startsAt, PERIOD.endsBefore],
    });
    expect(range.where).not.toContain('restaurant_id');
    expect(range.where).not.toContain('IS NULL');
  });
});
