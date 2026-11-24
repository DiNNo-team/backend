import type { DataSource, QueryRunner } from 'typeorm';

// Lo mínimo que necesitan los scripts de datos para hablar con Postgres: SQL
// con parámetros y el número de filas. Así la lógica de cada script no depende
// de TypeORM y se prueba con la misma conexión que usa la prueba.
export interface SqlResult<T> {
  rows: T[];
  rowCount: number;
}

export interface SqlRunner {
  query<T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<SqlResult<T>>;
}

export function fromQueryRunner(queryRunner: QueryRunner): SqlRunner {
  return {
    query: async <T extends object>(sql: string, params?: unknown[]) => {
      const result = await queryRunner.query(sql, params, true);
      const rows = result.records as T[];
      return { rows, rowCount: result.affected ?? rows.length };
    },
  };
}

export type TransactionMode = 'read-only' | 'read-write';

// Corre `work` en UNA transacción. En 'read-only' la base misma rechaza
// cualquier escritura (SET TRANSACTION READ ONLY); en 'read-write' un error
// deja todo como estaba (ROLLBACK).
export async function inTransaction<T>(
  dataSource: DataSource,
  mode: TransactionMode,
  work: (runner: SqlRunner) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.startTransaction();
    try {
      if (mode === 'read-only') {
        await queryRunner.query('SET TRANSACTION READ ONLY');
      }
      const result = await work(fromQueryRunner(queryRunner));
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    }
  } finally {
    await queryRunner.release();
  }
}
