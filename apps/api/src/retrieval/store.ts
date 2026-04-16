import type { PostgresClient } from "../auth/postgres.js";
import { buildStoredKeywordVerificationResponse } from "./privacy.js";
import type { SaveKeywordVerificationRunInput } from "./types.js";

interface IdRow {
  id: string;
}

export interface KeywordVerificationStore {
  ensureSchema(): Promise<void>;
  saveRun(input: SaveKeywordVerificationRunInput): Promise<string>;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function createKeywordVerificationStore(db: PostgresClient): KeywordVerificationStore {
  async function ensureSchema(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS keyword_verification_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        guest_id TEXT,
        query_text TEXT NOT NULL,
        normalized_query TEXT NOT NULL,
        context_type TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE keyword_verification_runs
      ADD COLUMN IF NOT EXISTS profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS keyword_verification_runs_user_created_idx
      ON keyword_verification_runs (user_id, created_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS keyword_verification_runs_guest_created_idx
      ON keyword_verification_runs (guest_id, created_at DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS keyword_verification_hits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES keyword_verification_runs(id) ON DELETE CASCADE,
        reference_source_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('law', 'precedent')),
        query_text TEXT NOT NULL,
        issue_type TEXT,
        rank_order INTEGER NOT NULL,
        match_reason TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS keyword_verification_hits_run_rank_idx
      ON keyword_verification_hits (run_id, rank_order ASC)
    `);
  }

  async function saveRun(input: SaveKeywordVerificationRunInput): Promise<string> {
    return db.withTransaction(async (tx) => {
      const runResult = await tx.query<IdRow>(
        `
          INSERT INTO keyword_verification_runs (
            user_id,
            guest_id,
            query_text,
            normalized_query,
            context_type,
            provider_mode,
            profile_snapshot,
            plan_json,
            response_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
          RETURNING id
        `,
        [
          input.actor.userId ?? null,
          input.actor.guestId ?? null,
          input.request.query,
          input.plan.normalizedQuery,
          input.request.contextType,
          input.providerMode,
          toJson(input.profileSnapshot ?? {}),
          toJson(input.plan),
          toJson({})
        ]
      );

      const runId = runResult.rows[0]?.id;
      if (!runId) {
        throw new Error("Failed to save keyword verification run.");
      }

      await tx.query(
        `
          UPDATE keyword_verification_runs
          SET response_json = $2::jsonb
          WHERE id = $1
        `,
        [
          runId,
          toJson(
            buildStoredKeywordVerificationResponse({
              ...input.response,
              run_id: runId,
              retrieval_evidence_pack: {
                ...input.response.retrieval_evidence_pack,
                run_id: runId
              }
            })
          )
        ]
      );

      const topIssue = input.plan.candidateIssues[0]?.type ?? null;
      const hits = [
        ...input.response.matched_laws,
        ...input.response.matched_precedents
      ];

      for (const [index, hit] of hits.entries()) {
        await tx.query(
          `
            INSERT INTO keyword_verification_hits (
              run_id,
              reference_source_key,
              kind,
              query_text,
              issue_type,
              rank_order,
              match_reason,
              confidence_score
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            runId,
            hit.reference.id,
            hit.kind,
            input.request.query,
            topIssue,
            index + 1,
            hit.matchReason,
            hit.confidenceScore
          ]
        );
      }

      return runId;
    });
  }

  return {
    ensureSchema,
    saveRun
  };
}
