// Tipos mínimos de `pg` para las pruebas contra Postgres real: @types/pg no
// está instalado. Solo declara lo que usa test/db. Si algún día se agrega
// @types/pg, este archivo se borra.
declare module 'pg' {
  export interface QueryResult<Row> {
    rows: Row[];
    rowCount: number | null;
  }

  export interface ClientConfig {
    connectionString: string;
    ssl?: boolean | { rejectUnauthorized: boolean };
    connectionTimeoutMillis?: number;
  }

  export class Client {
    constructor(config: ClientConfig);
    connect(): Promise<void>;
    query<Row = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
