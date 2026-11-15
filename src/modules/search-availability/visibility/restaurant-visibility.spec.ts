import {
  DINER_VISIBLE_RESTAURANT,
  isVisibleToDiners,
} from './restaurant-visibility.js';

describe('diner visibility of a restaurant (§11)', () => {
  it('is a where fragment that asks only for approved restaurants', () => {
    expect(DINER_VISIBLE_RESTAURANT).toEqual({ approvalStatus: 'approved' });
  });

  it('cannot be changed by whoever spreads it', () => {
    expect(Object.isFrozen(DINER_VISIBLE_RESTAURANT)).toBe(true);
  });

  it.each([
    ['approved', true],
    ['pending', false],
    ['rejected', false],
  ] as const)('a %s restaurant is visible: %s', (status, visible) => {
    expect(isVisibleToDiners(status)).toBe(visible);
  });
});
