// Postgres unique violation (23505), either as TypeORM wraps it
// (QueryFailedError with driverError) or as the bare driver error. With a
// constraint name, only a violation of that constraint matches.
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    driverError?: { code?: unknown; constraint?: unknown };
  };
  const isUnique =
    candidate.code === '23505' || candidate.driverError?.code === '23505';
  if (!isUnique || constraint === undefined) {
    return isUnique;
  }
  return (
    candidate.constraint === constraint ||
    candidate.driverError?.constraint === constraint
  );
}
