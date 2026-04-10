import { Pool } from "pg";

import type { DatabaseConfig } from "./config.js";

export interface PostgresClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
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
    async close() {
      await pool.end();
    }
  };
}
