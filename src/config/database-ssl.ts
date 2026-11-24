// TLS options for pg from the sslmode in DATABASE_URL (Sprint 4, hardening):
// - verify-full: encrypted and the server certificate is checked (Azure
//   Database for PostgreSQL; its CA is in Node's trust store). Use this one.
// - require: encrypted without checking the certificate (Neon, as until now).
// - anything else: no TLS (local Docker).
// TypeORM passes `ssl` to pg as is, so the sslmode in the URL alone does not
// decide it.
export function databaseSsl(
  databaseUrl: string,
): false | { rejectUnauthorized: boolean } {
  if (databaseUrl.includes('sslmode=verify-full')) {
    return { rejectUnauthorized: true };
  }
  if (databaseUrl.includes('sslmode=require')) {
    return { rejectUnauthorized: false };
  }
  return false;
}
