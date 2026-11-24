import { describe, expect, it } from 'vitest';
import { checkInFeeCop } from './check-in-fee.js';

describe('checkInFeeCop', () => {
  it.each([
    [1, 1500, 1500],
    [2, 1500, 3000],
    [4, 1500, 6000],
    [5, 1500, 7500],
    [20, 1500, 30000],
    [3, 0, 0],
    [4, 1_000_000, 4_000_000],
  ])('%i personas a %i por persona cobran %i', (guests, rate, expected) => {
    expect(checkInFeeCop(guests, rate)).toBe(expected);
  });
});
