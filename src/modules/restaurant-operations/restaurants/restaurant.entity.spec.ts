import { coordinateTransformer } from './restaurant.entity.js';

describe('coordinateTransformer', () => {
  it('reads numeric(9,6), which pg returns as text, as a number', () => {
    expect(coordinateTransformer.from('4.655671')).toBe(4.655671);
    expect(coordinateTransformer.from('-74.057006')).toBe(-74.057006);
  });

  it('reads a missing coordinate as null', () => {
    expect(coordinateTransformer.from(null)).toBeNull();
  });

  it('writes the number as it is: pg accepts it for numeric', () => {
    expect(coordinateTransformer.to(4.655671)).toBe(4.655671);
    expect(coordinateTransformer.to(null)).toBeNull();
  });
});
