import { createHash } from "node:crypto";

import type { PostgresClient } from "../auth/postgres.js";
import {
  buildReferenceSeeds,
  escapeLike,
  mapReferenceDetailRow,
  mapReferenceRow,
  type ReferenceDetailItem,
  type ReferenceLibraryItem,
  type ReferenceRow
} from "./references.js";

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

interface GuestIpUsageRow {
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
  preview?: unknown;
  trace?: unknown[];
  profileSnapshot?: Record<string, unknown> | null;
  persistSourceDocument?: boolean;
}

export interface SaveReferenceLibraryInput {
  providerMode: string;
  result: Record<string, unknown>;
  caseId?: string | null;
  runId?: string | null;
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
  guestId: string | null;
  usageCount: number;
  limit: number;
  remaining: number;
  allowed: boolean;
}

export interface GuestUsageIdentity {
  guestId?: string | null;
  ipAddress: string;
}

export interface AnalysisStore {
  ensureSchema(): Promise<void>;
  saveAnalysis(input: SaveAnalysisInput): Promise<{ caseId: string; runId: string; referenceLibrary: ReferenceLibraryItem[] }>;
  saveReferenceLibrary(input: SaveReferenceLibraryInput): Promise<ReferenceLibraryItem[]>;
  listHistory(userId: number, limit?: number): Promise<AnalysisHistoryItem[]>;
  consumeGuestAnalysis(identity: GuestUsageIdentity, limit?: number): Promise<GuestUsageResult>;
  searchReferences(query: string, limit?: number): Promise<ReferenceLibraryItem[]>;
  getReferenceByKindAndId(kind: "law" | "precedent", id: string): Promise<ReferenceDetailItem | null>;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function currentKstDate(): string {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
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
        profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_json JSONB NOT NULL,
        preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        trace_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        timeline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE analysis_runs
      ADD COLUMN IF NOT EXISTS profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    await db.query(`
      ALTER TABLE analysis_runs
      ADD COLUMN IF NOT EXISTS preview_json JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
    await db.query(`
      ALTER TABLE analysis_runs
      ADD COLUMN IF NOT EXISTS trace_json JSONB NOT NULL DEFAULT '[]'::jsonb
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
    await db.query(`
      CREATE TABLE IF NOT EXISTS guest_analysis_ip_usage (
        usage_key TEXT PRIMARY KEY,
        ip_hash TEXT NOT NULL,
        usage_date DATE NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS guest_analysis_ip_usage_date_idx
      ON guest_analysis_ip_usage (usage_date, updated_at DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS reference_library (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind TEXT NOT NULL CHECK (kind IN ('law', 'precedent')),
        source_key TEXT NOT NULL UNIQUE,
        case_id UUID REFERENCES analysis_cases(id) ON DELETE SET NULL,
        run_id UUID REFERENCES analysis_runs(id) ON DELETE SET NULL,
        source_mode TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        summary TEXT NOT NULL,
        details TEXT NOT NULL,
        url TEXT,
        article_no TEXT,
        case_no TEXT,
        court TEXT,
        verdict TEXT,
        penalty TEXT,
        similarity_score REAL,
        keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        search_text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS reference_library_kind_updated_idx
      ON reference_library (kind, updated_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS reference_library_case_idx
      ON reference_library (case_id, run_id)
    `);
  }

  async function upsertReferenceSeed(
    seed: ReturnType<typeof buildReferenceSeeds>[number],
    caseId?: string | null,
    runId?: string | null
  ): Promise<ReferenceLibraryItem> {
    const result = await db.query<ReferenceRow>(
      `
        INSERT INTO reference_library (
          kind,
          source_key,
          case_id,
          run_id,
          source_mode,
          title,
          subtitle,
          summary,
          details,
          url,
          article_no,
          case_no,
          court,
          verdict,
          penalty,
          similarity_score,
          keywords,
          payload_json,
          search_text
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19)
        ON CONFLICT (source_key)
        DO UPDATE SET
          case_id = COALESCE(EXCLUDED.case_id, reference_library.case_id),
          run_id = COALESCE(EXCLUDED.run_id, reference_library.run_id),
          source_mode = EXCLUDED.source_mode,
          title = EXCLUDED.title,
          subtitle = EXCLUDED.subtitle,
          summary = EXCLUDED.summary,
          details = EXCLUDED.details,
          url = EXCLUDED.url,
          article_no = EXCLUDED.article_no,
          case_no = EXCLUDED.case_no,
          court = EXCLUDED.court,
          verdict = EXCLUDED.verdict,
          penalty = EXCLUDED.penalty,
          similarity_score = EXCLUDED.similarity_score,
          keywords = EXCLUDED.keywords,
          payload_json = EXCLUDED.payload_json,
          search_text = EXCLUDED.search_text,
          updated_at = NOW()
        RETURNING *
      `,
      [
        seed.kind,
        seed.sourceKey,
        caseId ?? null,
        runId ?? null,
        seed.sourceMode,
        seed.title,
        seed.subtitle,
        seed.summary,
        seed.details,
        seed.url,
        seed.articleNo,
        seed.caseNo,
        seed.court,
        seed.verdict,
        seed.penalty,
        seed.similarityScore,
        toJson(seed.keywords),
        toJson(seed.payload),
        seed.searchText
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to save reference library item.");
    }
    return mapReferenceRow(row);
  }

  async function saveReferenceLibrary(input: SaveReferenceLibraryInput): Promise<ReferenceLibraryItem[]> {
    const seeds = buildReferenceSeeds(input.result, input.providerMode);
    if (seeds.length === 0) {
      return [];
    }

    const items: ReferenceLibraryItem[] = [];
    for (const seed of seeds) {
      items.push(await upsertReferenceSeed(seed, input.caseId ?? null, input.runId ?? null));
    }
    return items;
  }

  async function saveAnalysis(
    input: SaveAnalysisInput
  ): Promise<{ caseId: string; runId: string; referenceLibrary: ReferenceLibraryItem[] }> {
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

    if (input.persistSourceDocument !== false && input.contentText.trim()) {
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
          toJson(input.metadata ?? {})
        ]
      );
    }

    const legalAnalysis = (input.result.legal_analysis ?? {}) as Record<string, unknown>;
    const runResult = await db.query<IdRow>(
      `
        INSERT INTO analysis_runs (
          case_id,
          user_id,
          provider_mode,
          can_sue,
          risk_level,
          profile_snapshot,
          result_json,
          preview_json,
          trace_json,
          timeline_json
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
        RETURNING id
      `,
      [
        caseId,
        input.userId,
        input.providerMode,
        Boolean(legalAnalysis.can_sue),
        Number(legalAnalysis.risk_level ?? 0),
        toJson(input.profileSnapshot ?? {}),
        toJson(input.result),
        toJson(input.preview ?? {}),
        toJson(input.trace ?? []),
        toJson(input.timeline)
      ]
    );

    const runId = runResult.rows[0]?.id;
    if (!runId) {
      throw new Error("Failed to create analysis run.");
    }

    const referenceLibrary = await saveReferenceLibrary({
      providerMode: input.providerMode,
      result: input.result,
      caseId,
      runId
    });

    return { caseId, runId, referenceLibrary };
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

  async function consumeGuestAnalysis(identity: GuestUsageIdentity, limit = 10): Promise<GuestUsageResult> {
    const guestId = String(identity.guestId ?? "").trim() || null;
    const normalizedIp = String(identity.ipAddress ?? "").trim();
    if (!normalizedIp) {
      throw new Error("ipAddress is required for guest analysis.");
    }

    const usageDate = currentKstDate();
    const ipHash = stableHash(normalizedIp);
    const usageKey = stableHash(`${ipHash}:${usageDate}`);

    const allowedResult = await db.query<GuestIpUsageRow>(
      `
        INSERT INTO guest_analysis_ip_usage (usage_key, ip_hash, usage_date, usage_count)
        VALUES ($1, $2, $3::date, 1)
        ON CONFLICT (usage_key)
        DO UPDATE SET
          usage_count = guest_analysis_ip_usage.usage_count + 1,
          updated_at = NOW()
        WHERE guest_analysis_ip_usage.usage_count < $4
        RETURNING usage_count
      `,
      [usageKey, ipHash, usageDate, limit]
    );

    const allowedUsageCount = Number(allowedResult.rows[0]?.usage_count ?? 0);
    if (allowedUsageCount > 0) {
      return {
        guestId,
        usageCount: allowedUsageCount,
        limit,
        remaining: Math.max(limit - allowedUsageCount, 0),
        allowed: true
      };
    }

    const currentResult = await db.query<GuestIpUsageRow>(
      "SELECT usage_count FROM guest_analysis_ip_usage WHERE usage_key = $1 LIMIT 1",
      [usageKey]
    );
    const currentUsageCount = Number(currentResult.rows[0]?.usage_count ?? limit);

    return {
      guestId,
      usageCount: currentUsageCount,
      limit,
      remaining: 0,
      allowed: false
    };
  }

  async function searchReferences(query: string, limit = 12): Promise<ReferenceLibraryItem[]> {
    const terms = String(query ?? "")
      .trim()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 8);

    if (terms.length === 0) {
      return [];
    }

    const conditions: string[] = [];
    const params: string[] = [];
    terms.forEach((term, index) => {
      const paramIndex = index + 1;
      params.push(`%${escapeLike(term)}%`);
      conditions.push(
        `(
          title ILIKE $${paramIndex} ESCAPE '\\' OR
          subtitle ILIKE $${paramIndex} ESCAPE '\\' OR
          summary ILIKE $${paramIndex} ESCAPE '\\' OR
          details ILIKE $${paramIndex} ESCAPE '\\' OR
          search_text ILIKE $${paramIndex} ESCAPE '\\' OR
          source_key ILIKE $${paramIndex} ESCAPE '\\'
        )`
      );
    });

    const result = await db.query<ReferenceRow>(
      `
        SELECT *
        FROM reference_library
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $${terms.length + 1}
      `,
      [...params, limit]
    );

    return result.rows.map((row) => mapReferenceRow(row));
  }

  async function getReferenceByKindAndId(
    kind: "law" | "precedent",
    id: string
  ): Promise<ReferenceDetailItem | null> {
    const result = await db.query<ReferenceRow>(
      `
        SELECT *
        FROM reference_library
        WHERE kind = $1 AND source_key = $2
        LIMIT 1
      `,
      [kind, id]
    );

    const row = result.rows[0];
    return row ? mapReferenceDetailRow(row) : null;
  }

  return {
    ensureSchema,
    saveAnalysis,
    saveReferenceLibrary,
    listHistory,
    consumeGuestAnalysis,
    searchReferences,
    getReferenceByKindAndId
  };
}
