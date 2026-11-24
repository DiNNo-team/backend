import {
  CHECKIN_FEE_PER_GUEST_DEFAULT_COP,
  parseCheckInFeePerGuest,
} from './checkin-fee.config.js';

describe('parseCheckInFeePerGuest', () => {
  it('defaults to 1500 when undefined', () => {
    expect(parseCheckInFeePerGuest(undefined)).toBe(
      CHECKIN_FEE_PER_GUEST_DEFAULT_COP,
    );
    expect(CHECKIN_FEE_PER_GUEST_DEFAULT_COP).toBe(1500);
  });

  it.each([
    ['0', 0],
    ['1500', 1500],
    [' 3500 ', 3500],
    ['1000000', 1_000_000],
  ])('accepts %j', (raw, fee) => {
    expect(parseCheckInFeePerGuest(raw)).toBe(fee);
  });

  it.each([
    '',
    '   ',
    'mil quinientos',
    '1500.5',
    '1.500',
    '-1',
    '+1500',
    '1000001',
    '1e3',
    '0x10',
  ])('rejects %j with a message in Spanish that names the variable', (raw) => {
    expect(() => parseCheckInFeePerGuest(raw)).toThrow(
      /^CHECKIN_FEE_PER_GUEST_COP debe ser/,
    );
  });
});
