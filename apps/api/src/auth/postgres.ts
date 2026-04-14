import { Pool } from "pg";

import type { DatabaseConfig } from "./config.js";

export interface PostgresClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
  withTransaction<T>(fn: (client: PostgresClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPostgresClient(config: DatabaseConfig): PostgresClient {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password
  });

  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount
      };
    },
    async withTransaction<T>(fn: (client: PostgresClient) => Promise<T>) {
      const client = await pool.connect();
      const transactionalClient: PostgresClient = {
        async query<U = Record<string, unknown>>(text: string, params: unknown[] = []) {
          const result = await client.query(text, params);
          return {
            rows: result.rows as U[],
            rowCount: result.rowCount
          };
        },
        async withTransaction<U>(innerFn: (nestedClient: PostgresClient) => Promise<U>) {
          return innerFn(transactionalClient);
        },
        async close() {
          // no-op inside a transaction-scoped client wrapper
        }
      };

      try {
        await client.query("BEGIN");
        const result = await fn(transactionalClient);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
