import { createHash } from "node:crypto";

import type { PostgresClient } from "../auth/postgres.js";

interface IdRow {
  id: string;
}

interface HistoryRow {
  case_id: string;
  input_mode: string;
  context_type: string;
  title: string | null;
  source_url: string | null;
  created_at: string;
  result_json: Record<string, unknown>;
}

interface GuestUsageRow {
  usage_count: number;
}

export interface SaveAnalysisInput {
  userId: number;
  inputMode: "text" | "image" | "link";
  contextType: string;
  title: string;
  sourceKind: "manual" | "ocr" | "crawl";
  sourceUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  contentText: string;
  metadata?: Record<string, unknown>;
  providerMode: string;
  result: Record<string, unknown>;
  timeline: unknown[];
}

export interface AnalysisHistoryItem {
  caseId: string;
  inputMode: string;
  contextType: string;
  title: string;
  sourceUrl: string | null;
  createdAt: string;
  summary: string;
  riskLevel: number;
  canSue: boolean;
}

export interface GuestUsageResult {
  guestId: string;
  usageCount: number;
  limit: number;
  remaining: number;
  allowed: boolean;
}

export interface AnalysisStore {
  ensureSchema(): Promise<void>;
  saveAnalysis(input: SaveAnalysisInput): Promise<{ caseId: string; runId: string }>;
  listHistory(userId: number, limit?: number): Promise<AnalysisHistoryItem[]>;
  consumeGuestAnalysis(guestId: string, limit?: number): Promise<GuestUsageResult>;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createAnalysisStore(db: PostgresClient): AnalysisStore {
  async function ensureSchema(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS analysis_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        input_mode TEXT NOT NULL,
        context_type TEXT NOT NULL,
        title TEXT,
        source_url TEXT,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS analysis_cases_user_created_idx
      ON analysis_cases (user_id, created_at DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS source_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES analysis_cases(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL,
        original_filename TEXT,
        source_url TEXT,
        mime_type TEXT,
        content_text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS source_documents_case_created_idx
      ON source_documents (case_id, created_at DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS analysis_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES analysis_cases(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
        provider_mode TEXT NOT NULL,
        can_sue BOOLEAN NOT NULL DEFAULT FALSE,
        risk_level SMALLINT NOT NULL DEFAULT 0,
        result_json JSONB NOT NULL,
        timeline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS analysis_runs_user_created_idx
      ON analysis_runs (user_id, created_at DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS guest_analysis_usage (
        guest_id TEXT PRIMARY KEY,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async function saveAnalysis(input: SaveAnalysisInput): Promise<{ caseId: string; runId: string }> {
    const caseResult = await db.query<IdRow>(
      `
        INSERT INTO analysis_cases (user_id, input_mode, context_type, title, source_url)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [input.userId, input.inputMode, input.contextType, input.title || null, input.sourceUrl ?? null]
    );
    const caseId = caseResult.rows[0]?.id;
    if (!caseId) {
      throw new Error("Failed to create analysis case.");
    }

    await db.query(
      `
        INSERT INTO source_documents (
          case_id,
          source_kind,
          original_filename,
          source_url,
          mime_type,
          content_text,
          content_hash,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        caseId,
        input.sourceKind,
        input.originalFilename ?? null,
        input.sourceUrl ?? null,
        input.mimeType ?? null,
        input.contentText,
        stableHash(input.contentText),
        JSON.stringify(input.metadata ?? {})
      ]
    );

    const legalAnalysis = (input.result.legal_analysis ?? {}) as Record<string, unknown>;
    const runResult = await db.query<IdRow>(
      `
        INSERT INTO analysis_runs (
          case_id,
          user_id,
          provider_mode,
          can_sue,
          risk_level,
          result_json,
          timeline_json
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        RETURNING id
      `,
      [
        caseId,
        input.userId,
        input.providerMode,
        Boolean(legalAnalysis.can_sue),
        Number(legalAnalysis.risk_level ?? 0),
        JSON.stringify(input.result),
        JSON.stringify(input.timeline)
      ]
    );

    const runId = runResult.rows[0]?.id;
    if (!runId) {
      throw new Error("Failed to create analysis run.");
    }

    return { caseId, runId };
  }

  async function listHistory(userId: number, limit = 12): Promise<AnalysisHistoryItem[]> {
    const result = await db.query<HistoryRow>(
      `
        SELECT
          c.id AS case_id,
          c.input_mode,
          c.context_type,
          c.title,
          c.source_url,
          r.created_at,
          r.result_json
        FROM analysis_runs r
        JOIN analysis_cases c ON c.id = r.case_id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    return result.rows.map((row) => {
      const legalAnalysis = ((row.result_json ?? {}) as Record<string, unknown>).legal_analysis as
        | Record<string, unknown>
        | undefined;

      return {
        caseId: row.case_id,
        inputMode: row.input_mode,
        contextType: row.context_type,
        title: row.title ?? "사건 파일",
        sourceUrl: row.source_url,
        createdAt: row.created_at,
        summary: typeof legalAnalysis?.summary === "string" ? legalAnalysis.summary : "분석 결과",
        riskLevel: Number(legalAnalysis?.risk_level ?? 0),
        canSue: Boolean(legalAnalysis?.can_sue)
      };
    });
  }

  async function consumeGuestAnalysis(guestId: string, limit = 3): Promise<GuestUsageResult> {
    const normalizedGuestId = String(guestId ?? "").trim();
    if (!normalizedGuestId) {
      throw new Error("guest_id is required for guest analysis.");
    }

    const allowedResult = await db.query<GuestUsageRow>(
      `
        INSERT INTO guest_analysis_usage (guest_id, usage_count)
        VALUES ($1, 1)
        ON CONFLICT (guest_id)
        DO UPDATE SET
          usage_count = guest_analysis_usage.usage_count + 1,
          updated_at = NOW()
        WHERE guest_analysis_usage.usage_count < $2
        RETURNING usage_count
      `,
      [normalizedGuestId, limit]
    );

    const allowedUsageCount = Number(allowedResult.rows[0]?.usage_count ?? 0);
    if (allowedUsageCount > 0) {
      return {
        guestId: normalizedGuestId,
        usageCount: allowedUsageCount,
        limit,
        remaining: Math.max(limit - allowedUsageCount, 0),
        allowed: true
      };
    }

    const currentResult = await db.query<GuestUsageRow>(
      "SELECT usage_count FROM guest_analysis_usage WHERE guest_id = $1 LIMIT 1",
      [normalizedGuestId]
    );
    const currentUsageCount = Number(currentResult.rows[0]?.usage_count ?? limit);

    return {
      guestId: normalizedGuestId,
      usageCount: currentUsageCount,
      limit,
      remaining: 0,
      allowed: false
    };
  }

  return {
    ensureSchema,
    saveAnalysis,
    listHistory,
    consumeGuestAnalysis
  };
}
