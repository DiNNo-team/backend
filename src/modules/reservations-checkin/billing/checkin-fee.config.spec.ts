import {
  CHECKIN_FEE_DEFAULT_COP,
  parseCheckInFee,
} from './checkin-fee.config.js';

describe('parseCheckInFee', () => {
  it('defaults to 2000 when undefined', () => {
    expect(parseCheckInFee(undefined)).toBe(CHECKIN_FEE_DEFAULT_COP);
    expect(CHECKIN_FEE_DEFAULT_COP).toBe(2000);
  });

  it.each([
    ['0', 0],
    ['2000', 2000],
    [' 3500 ', 3500],
    ['1000000', 1_000_000],
  ])('accepts %j', (raw, fee) => {
    expect(parseCheckInFee(raw)).toBe(fee);
  });

  it.each([
    '',
    '   ',
    'dos mil',
    '2000.5',
    '2.000',
    '-1',
    '+2000',
    '1000001',
    '1e3',
    '0x10',
  ])('rejects %j with a message in Spanish that names the variable', (raw) => {
    expect(() => parseCheckInFee(raw)).toThrow(/^CHECKIN_FEE_COP debe ser/);
  });
});
