import { databaseSsl } from './database-ssl.js';

describe('databaseSsl', () => {
  it('checks the certificate with sslmode=verify-full', () => {
    expect(
      databaseSsl('postgres://u:p@host:5432/dinno?sslmode=verify-full'),
    ).toEqual({ rejectUnauthorized: true });
  });

  it('keeps encrypting without checking it with sslmode=require', () => {
    expect(databaseSsl('postgres://u:p@host/dinno?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('uses no TLS without sslmode', () => {
    expect(databaseSsl('postgres://u:p@localhost:5432/dinno')).toBe(false);
  });
});
