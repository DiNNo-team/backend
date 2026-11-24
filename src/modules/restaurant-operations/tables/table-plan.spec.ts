import {
  findPlanProblem,
  PLAN_COLUMNS,
  PLAN_ROWS,
  tableFootprint,
  type PlacedTable,
} from './table-plan.js';

const placed = (overrides: Partial<PlacedTable>): PlacedTable => ({
  id: 'a',
  x: 0,
  y: 0,
  capacity: 4,
  shape: null,
  ...overrides,
});

describe('table plan', () => {
  // The web keeps the same table (frontend: features/tables/plan/plan-geometry.ts).
  it('keeps the grid the web draws: 20 columns, up to 30 rows', () => {
    expect([PLAN_COLUMNS, PLAN_ROWS]).toEqual([20, 30]);
  });

  it.each([
    [2, null, { width: 3, height: 2 }],
    [4, null, { width: 3, height: 2 }],
    [5, null, { width: 4, height: 2 }],
    [8, 'rect', { width: 4, height: 2 }],
    [9, null, { width: 5, height: 2 }],
    [20, 'rect', { width: 5, height: 2 }],
    [2, 'square', { width: 3, height: 3 }],
    [12, 'round', { width: 3, height: 3 }],
  ] as const)(
    'gives a table of %i people with shape %s a %o footprint',
    (capacity, shape, footprint) => {
      expect(tableFootprint(capacity, shape)).toEqual(footprint);
    },
  );

  it('accepts tables side by side and an empty plan', () => {
    expect(findPlanProblem([])).toBeNull();
    expect(
      findPlanProblem([
        placed({ id: 'a', x: 0, y: 0 }),
        placed({ id: 'b', x: 3, y: 0 }),
        placed({ id: 'c', x: 0, y: 2 }),
      ]),
    ).toBeNull();
  });

  it('accepts a table touching the last column and the last row', () => {
    expect(
      findPlanProblem([placed({ x: PLAN_COLUMNS - 3, y: PLAN_ROWS - 2 })]),
    ).toBeNull();
  });

  it.each([
    ['past the right edge', { x: PLAN_COLUMNS - 2 }],
    ['past the bottom edge', { y: PLAN_ROWS - 1 }],
    ['a big table that grows past the edge', { x: 16, capacity: 12 }],
  ])('reports out-of-bounds for a table %s', (_case, overrides) => {
    expect(findPlanProblem([placed(overrides)])).toBe('out-of-bounds');
  });

  it('reports overlap when two footprints share a cell', () => {
    expect(
      findPlanProblem([
        placed({ id: 'a', x: 0, y: 0 }),
        placed({ id: 'b', x: 2, y: 1, shape: 'round' }),
      ]),
    ).toBe('overlap');
  });
});
