import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './unique-violation.js';

function queryFailed(code: string, constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error('driver error'), {
    code,
    constraint,
  });
  return new QueryFailedError('UPDATE users', [], driverError);
}

describe('isUniqueViolation', () => {
  it.each<[string, unknown, string | undefined, boolean]>([
    [
      'a TypeORM 23505 on the given constraint',
      queryFailed('23505', 'UQ_users_firebase_uid'),
      'UQ_users_firebase_uid',
      true,
    ],
    [
      'a TypeORM 23505 on another constraint',
      queryFailed('23505', 'UQ_users_email'),
      'UQ_users_firebase_uid',
      false,
    ],
    [
      'a TypeORM 23505 with no constraint asked',
      queryFailed('23505', 'UQ_users_email'),
      undefined,
      true,
    ],
    ['a bare driver 23505', { code: '23505' }, undefined, true],
    [
      'a different database error',
      queryFailed('23503', 'FK_users_restaurant_id'),
      undefined,
      false,
    ],
    ['a value that is not an object', '23505', undefined, false],
    ['null', null, undefined, false],
  ])('detects %s', (_case, error, constraint, expected) => {
    expect(isUniqueViolation(error, constraint)).toBe(expected);
  });
});
