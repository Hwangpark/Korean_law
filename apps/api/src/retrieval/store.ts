import type { PostgresClient } from "../auth/postgres.js";
import type {
  KeywordVerificationOutput,
  KeywordVerificationPlan,
  QueryHitRecord,
  QueryRunRecord,
  RetrievalRunDetail,
  RetrievalKind
} from "./types.js";

interface IdRow {
  id: string;
}

interface RunRow {
  id: string;
  query_text: string;
  context_type: string;
  provider_mode: string;
  user_id: number | null;
  planner_json: Record<string, unknown>;
  verification_json: Record<string, unknown>;
  result_count: number;
  top_score: number;
  created_at: string;
  updated_at: string;
}

interface HitRow {
  id: string;
  run_id: string;
  kind: RetrievalKind;
  source_key: string;
  score: number;
  rank: number;
  matched_terms: string[] | string;
  reference_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface SaveRetrievalRunInput {
  userId: number | null;
  plan: KeywordVerificationPlan;
  verification: KeywordVerificationOutput["verification"];
  resultCount: number;
  topScore: number;
  hits: Array<{
    kind: RetrievalKind;
    sourceKey: string;
    score: number;
    rank: number;
    matchedTerms: string[];
    referenceSnapshot: Record<string, unknown>;
  }>;
}

export interface RetrievalStore {
  ensureSchema(): Promise<void>;
  saveQueryRun(input: SaveRetrievalRunInput): Promise<RetrievalRunDetail>;
  getRun(runId: string): Promise<RetrievalRunDetail | null>;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseArray(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [String(value)];
  } catch {
    return [String(value)];
  }
}

export function createRetrievalStore(db: PostgresClient): RetrievalStore {
  async function ensureSchema(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS keyword_query_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        query_text TEXT NOT NULL,
        context_type TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        planner_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        verification_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_count INTEGER NOT NULL DEFAULT 0,
        top_score REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS keyword_query_runs_created_idx
      ON keyword_query_runs (created_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS keyword_query_runs_query_idx
      ON keyword_query_runs USING GIN (to_tsvector('simple', query_text))
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS keyword_query_hits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES keyword_query_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('law', 'precedent')),
        source_key TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL DEFAULT 0,
        matched_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
        reference_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS keyword_query_hits_run_idx
      ON keyword_query_hits (run_id, rank ASC)
    `);
  }

  async function saveQueryRun(input: SaveRetrievalRunInput): Promise<RetrievalRunDetail> {
    const runResult = await db.query<IdRow>(
      `
        INSERT INTO keyword_query_runs (
          user_id,
          query_text,
          context_type,
          provider_mode,
          planner_json,
          verification_json,
          result_count,
          top_score
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
        RETURNING id
      `,
      [
        input.userId,
        input.plan.query,
        input.plan.contextType,
        input.plan.providerMode,
        toJson(input.plan),
        toJson(input.verification),
        input.resultCount,
        input.topScore
      ]
    );

    const runId = runResult.rows[0]?.id;
    if (!runId) {
      throw new Error("Failed to create keyword query run.");
    }

    const hits: QueryHitRecord[] = [];
    for (const hit of input.hits) {
      const hitResult = await db.query<HitRow>(
        `
          INSERT INTO keyword_query_hits (
            run_id,
            kind,
            source_key,
            score,
            rank,
            matched_terms,
            reference_snapshot
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
          RETURNING *
        `,
        [
          runId,
          hit.kind,
          hit.sourceKey,
          hit.score,
          hit.rank,
          toJson(hit.matchedTerms),
          toJson(hit.referenceSnapshot)
        ]
      );

      const row = hitResult.rows[0];
      if (!row) {
        continue;
      }

      hits.push({
        id: row.id,
        run_id: row.run_id,
        kind: row.kind,
        source_key: row.source_key,
        score: row.score,
        rank: row.rank,
        matched_terms: parseArray(row.matched_terms),
        reference_snapshot: row.reference_snapshot ?? {},
        created_at: row.created_at
      });
    }

    const run = {
      id: runId,
      query_text: input.plan.query,
      context_type: input.plan.contextType,
      provider_mode: input.plan.providerMode,
      user_id: input.userId,
      planner_json: input.plan as unknown as Record<string, unknown>,
      verification_json: input.verification as unknown as Record<string, unknown>,
      result_count: input.resultCount,
      top_score: input.topScore,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return {
      run,
      hits
    };
  }

  async function getRun(runId: string): Promise<RetrievalRunDetail | null> {
    const runResult = await db.query<RunRow>(
      `
        SELECT *
        FROM keyword_query_runs
        WHERE id = $1
        LIMIT 1
      `,
      [runId]
    );

    const runRow = runResult.rows[0];
    if (!runRow) {
      return null;
    }

    const hitsResult = await db.query<HitRow>(
      `
        SELECT *
        FROM keyword_query_hits
        WHERE run_id = $1
        ORDER BY rank ASC, created_at ASC
      `,
      [runId]
    );

    return {
      run: {
        id: runRow.id,
        query_text: runRow.query_text,
        context_type: runRow.context_type,
        provider_mode: runRow.provider_mode,
        user_id: runRow.user_id,
        planner_json: runRow.planner_json,
        verification_json: runRow.verification_json,
        result_count: runRow.result_count,
        top_score: runRow.top_score,
        created_at: runRow.created_at,
        updated_at: runRow.updated_at
      },
      hits: hitsResult.rows.map((row) => ({
        id: row.id,
        run_id: row.run_id,
        kind: row.kind,
        source_key: row.source_key,
        score: row.score,
        rank: row.rank,
        matched_terms: parseArray(row.matched_terms),
        reference_snapshot: row.reference_snapshot ?? {},
        created_at: row.created_at
      }))
    };
  }

  return {
    ensureSchema,
    saveQueryRun,
    getRun
  };
}
