// Floor plan of the restaurant (identity manual v2.0, 13.10): a fixed grid of
// cells where each placed table takes a rectangle. Positions are cells, not
// pixels, so the plan is the same on every screen. The web mirrors these rules
// in features/tables/plan/plan-geometry.ts; table-plan.spec.ts pins the values
// both sides share.

export const PLAN_COLUMNS = 20;
export const PLAN_ROWS = 30;

export const TABLE_SHAPES = ['square', 'round', 'rect'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export interface PlanFootprint {
  width: number;
  height: number;
}

/**
 * Cells a table takes: square and round are 3 × 3; a rectangle (or no shape
 * chosen) grows with the capacity. Never narrower than 3 cells, so the status
 * word always fits on the smallest screen.
 */
export function tableFootprint(
  capacity: number,
  shape: TableShape | null,
): PlanFootprint {
  if (shape === 'square' || shape === 'round') return { width: 3, height: 3 };
  if (capacity <= 4) return { width: 3, height: 2 };
  if (capacity <= 8) return { width: 4, height: 2 };
  return { width: 5, height: 2 };
}

export interface PlacedTable {
  id: string;
  x: number;
  y: number;
  capacity: number;
  shape: TableShape | null;
}

export type PlanProblem = 'out-of-bounds' | 'overlap';

/** The first rule a plan breaks, or null: every table inside the grid, none on top of another. */
export function findPlanProblem(tables: PlacedTable[]): PlanProblem | null {
  const boxes = tables.map((table) => ({
    ...table,
    ...tableFootprint(table.capacity, table.shape),
  }));
  for (const box of boxes) {
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > PLAN_COLUMNS ||
      box.y + box.height > PLAN_ROWS
    ) {
      return 'out-of-bounds';
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const apart =
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y;
      if (!apart) return 'overlap';
    }
  }
  return null;
}
