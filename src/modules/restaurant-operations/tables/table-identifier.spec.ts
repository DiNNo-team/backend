import {
  formatTableName,
  normalizeTableIdentifier,
} from './table-identifier.js';

describe('normalizeTableIdentifier', () => {
  it.each([['4'], ['04'], ['Mesa 4'], ['mesa 04'], [' MESA 4 ']])(
    'gives "4" for %j',
    (identifier) => {
      expect(normalizeTableIdentifier(identifier)).toBe('4');
    },
  );

  it.each([['0'], ['00'], ['Mesa 0']])('gives "0" for %j', (identifier) => {
    expect(normalizeTableIdentifier(identifier)).toBe('0');
  });

  it.each([['T1'], ['t1'], ['Mesa T1']])('gives "t1" for %j', (identifier) => {
    expect(normalizeTableIdentifier(identifier)).toBe('t1');
  });

  it('keeps "mesa4" (no space) apart from "4"', () => {
    expect(normalizeTableIdentifier('mesa4')).not.toBe(
      normalizeTableIdentifier('4'),
    );
  });

  it('keeps different numbers apart', () => {
    expect(normalizeTableIdentifier('4')).not.toBe(
      normalizeTableIdentifier('14'),
    );
  });
});

describe('formatTableName', () => {
  it.each([
    ['4', 'Mesa 04'],
    ['04', 'Mesa 04'],
    ['12', 'Mesa 12'],
    ['Mesa 4', 'Mesa 04'],
  ])('shows the number %j as %j', (identifier, shown) => {
    expect(formatTableName(identifier)).toBe(shown);
  });

  it.each([
    ['T1', 'Mesa T1'],
    ['t1', 'Mesa t1'],
    ['Mesa T1', 'Mesa T1'],
  ])('shows the alphanumeric identifier %j as %j', (identifier, shown) => {
    expect(formatTableName(identifier)).toBe(shown);
  });
});
