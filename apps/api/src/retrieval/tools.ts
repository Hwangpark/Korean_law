import type { AuthService } from "../auth/service.js";
import { buildProfileContext } from "../analysis/profile-context.js";
import {
  buildLawReferenceKey,
  buildPrecedentReferenceKey
} from "../analysis/reference-keys.mjs";
import type { ReferenceLibraryItem } from "../analysis/references.js";
import type { AnalysisStore } from "../analysis/store.js";
import {
  createRetrievalAdapter,
  type RetrievalAdapter,
  type RetrievalLiveProvider
} from "./mcp-adapter.js";
import { buildAnalysisRetrievalPlan, buildKeywordQueryPlan } from "./planner.js";
import type {
  EvidenceQueryRef,
  KeywordContextType,
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  ProfileContext,
  RetrievalAdapterProviderInfo,
  RetrievalPreview,
  RetrievalToolDescriptor,
  RetrievalTraceEvent
} from "./types.js";

interface HttpError extends Error {
  status?: number;
}

interface ClassificationResultLike {
  searchable_text?: unknown;
  issues?: unknown;
}

interface OcrResultLike {
  raw_text?: unknown;
  utterances?: unknown;
}

interface AnalyzeRequestLike {
  context_type?: unknown;
  text?: unknown;
  url?: unknown;
  request_id?: unknown;
}

export interface RetrievalToolDeps {
  providerMode: string;
  liveProvider?: RetrievalLiveProvider | null;
  authService?: AuthService;
  analysisStore?: AnalysisStore;
}

export interface RetrievalToolSearchRequest {
  query?: unknown;
  context_type?: unknown;
  limit?: unknown;
  profile_context?: Record<string, unknown>;
  token?: string | null;
}

export interface RetrievalToolDetailRequest {
  law_id?: unknown;
  precedent_id?: unknown;
}

export type RetrievalToolListEntry = RetrievalToolDescriptor;

export interface RetrievalToolListResponse {
  tools: RetrievalToolDescriptor[];
}

export interface RetrievalToolSearchResponse {
  query: string;
  context_type: KeywordContextType;
  count: number;
  items: ReferenceLibraryItem[];
}

export interface RetrievalToolDetailResponse {
  item: ReferenceLibraryItem;
}

export interface RetrievalSearchResult<TRecord> {
  provider: string;
  records: TRecord[];
  retrieval_preview: RetrievalPreview;
  retrieval_trace: RetrievalTraceEvent[];
}

interface RetrievalToolRuntime extends RetrievalToolDeps {
  adapter: RetrievalAdapter;
  providerInfo: RetrievalAdapterProviderInfo;
}

const ALLOWED_CONTEXT_TYPES = new Set<KeywordContextType>([
  "community",
  "game_chat",
  "messenger",
  "other"
]);

const TOOL_DESCRIPTIONS: RetrievalToolDescriptor[] = [
  {
    name: "search_law_tool",
    description: "Search relevant statutes for the input text and context.",
    parameters: {
      query: "string",
      context_type: "community|game_chat|messenger|other",
      limit: "number"
    }
  },
  {
    name: "get_law_detail_tool",
    description: "Fetch statute details by law_id returned from search_law_tool.",
    parameters: {
      law_id: "string"
    }
  },
  {
    name: "search_precedent_tool",
    description: "Search similar precedents for the input text and context.",
    parameters: {
      query: "string",
      context_type: "community|game_chat|messenger|other",
      limit: "number"
    }
  },
  {
    name: "get_precedent_detail_tool",
    description: "Fetch precedent details by precedent_id returned from search_precedent_tool.",
    parameters: {
      precedent_id: "string"
    }
  }
];

function createToolRuntime(deps: RetrievalToolDeps): RetrievalToolRuntime {
  const adapter = createRetrievalAdapter({
    providerMode: deps.providerMode,
    liveProvider: deps.liveProvider ?? null
  });

  return {
    ...deps,
    adapter,
    providerInfo: adapter.providerInfo
  };
}

function requireString(value: unknown, message: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error(message) as HttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function parseContextType(value: unknown): KeywordContextType {
  const normalized = String(value ?? "community").trim() as KeywordContextType;
  if (!ALLOWED_CONTEXT_TYPES.has(normalized)) {
    const error = new Error("context_type must be one of community, game_chat, messenger, other.") as HttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function parseLimit(value: unknown, fallback: number, maximum: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(Math.floor(value), 1), maximum);
  }
  return fallback;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function buildProfileFlags(profileContext?: ProfileContext | null): string[] {
  if (!profileContext) {
    return [];
  }

  const flags: string[] = [];

  if (profileContext.ageBand) {
    flags.push(profileContext.ageBand);
  } else if (typeof profileContext.ageYears === "number") {
    flags.push(`${profileContext.ageYears} years old`);
  }

  if (profileContext.isMinor) {
    flags.push("minor");
  }

  if (profileContext.nationality === "foreign") {
    flags.push("foreign national");
  }

  return [...new Set(flags)];
}

function buildPreviewCardId(kind: "law" | "precedent", title: string, fallback: string): string {
  const normalized = normalizeText(title);
  return normalized ? `${kind}:${normalized}` : `${kind}:${fallback}`;
}

function buildSearchPreview(
  kind: "law" | "precedent",
  records: LawDocumentRecord[] | PrecedentDocumentRecord[],
  plan: KeywordQueryPlan,
  providerInfo: RetrievalAdapterProviderInfo,
  profileContext?: ProfileContext | null
): RetrievalPreview {
  const headline = plan.candidateIssues[0]
    ? `Searched ${kind === "law" ? "statutes" : "precedents"} for "${plan.originalQuery}" using the ${plan.candidateIssues[0].type} issue signal.`
    : `Searched ${kind === "law" ? "statutes" : "precedents"} for "${plan.originalQuery}".`;
  const disclaimer = providerInfo.source === "live"
    ? "Official provider results were normalized into the same retrieval contract as fixtures."
    : providerInfo.source === "live_fallback"
      ? "Live provider was requested but not injected, so deterministic fixture results were used."
      : "Deterministic fixture results were used for mock-first retrieval validation.";

  const topLaws = kind === "law"
    ? (records as LawDocumentRecord[]).slice(0, 3).map((record) => ({
        id: buildPreviewCardId("law", `${record.law_name} ${record.article_no}`.trim(), record.article_no),
        title: `${record.law_name} ${record.article_no}`.trim(),
        summary: record.article_title || record.content || record.penalty || "Related statute"
      }))
    : [];
  const topPrecedents = kind === "precedent"
    ? (records as PrecedentDocumentRecord[]).slice(0, 3).map((record) => ({
        id: buildPreviewCardId("precedent", record.case_no, record.case_no),
        title: `${record.case_no} ${record.court}`.trim(),
        summary: record.summary || record.key_reasoning || record.verdict || "Similar precedent"
      }))
    : [];

  return {
    headline,
    top_issues: plan.candidateIssues.map((issue) => issue.type).slice(0, 3),
    top_laws: topLaws,
    top_precedents: topPrecedents,
    profile_flags: buildProfileFlags(profileContext),
    disclaimer
  };
}

function buildTraceEvent(
  stage: "planner" | "law" | "precedent" | "detail",
  tool: string,
  provider: string,
  durationMs: number,
  inputRef: string,
  outputRef: string[],
  reason: string,
  cacheHit = false,
  queryRefs: EvidenceQueryRef[] = []
): RetrievalTraceEvent {
  return {
    stage,
    tool,
    provider,
    duration_ms: durationMs,
    cache_hit: cacheHit,
    input_ref: inputRef,
    output_ref: outputRef,
    reason,
    ...(queryRefs.length > 0 ? { query_refs: queryRefs } : {})
  };
}

function buildQueryPlanTrace(
  plan: KeywordQueryPlan,
  providerInfo: RetrievalAdapterProviderInfo,
  tool = "build_query_plan"
): RetrievalTraceEvent[] {
  const queryRefs = [
    ...(plan.lawQueryRefs ?? []),
    ...(plan.precedentQueryRefs ?? [])
  ];
  const querySources = [...new Set(
    plan.candidateIssues
      .flatMap((issue) => issue.querySources ?? [])
      .map((source) => String(source ?? "").trim())
      .filter(Boolean)
  )];

  return [
    buildTraceEvent(
      "planner",
      tool,
      providerInfo.provider,
      0,
      `query:${plan.originalQuery}`,
      plan.candidateIssues.map((issue) => issue.type),
      `Built retrieval plan from ${plan.candidateIssues.length} candidate issues.${querySources.length > 0 ? ` query_source=${querySources.join(",")}` : ""}`,
      false,
      queryRefs
    )
  ];
}

async function resolveProfileContext(
  runtime: RetrievalToolRuntime,
  token: string | null,
  payloadProfileContext: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | null> {
  const explicitContext = buildProfileContext(payloadProfileContext);
  if (explicitContext) {
    return explicitContext as unknown as Record<string, unknown>;
  }

  if (!token) {
    return null;
  }

  if (!runtime.authService) {
    return null;
  }

  const claims = await runtime.authService.verifyToken(token);
  const authProfileService = runtime.authService as AuthService & {
    getUserProfile?: (userId: number) => Promise<Record<string, unknown> | null>;
  };

  if (!authProfileService.getUserProfile) {
    return null;
  }

  const profile = await authProfileService.getUserProfile(Number(claims.sub));
  const context = buildProfileContext(profile);
  return context ? (context as unknown as Record<string, unknown>) : null;
}

async function materializeReferenceItems(
  runtime: RetrievalToolRuntime,
  result: Record<string, unknown>
): Promise<ReferenceLibraryItem[]> {
  if (!runtime.analysisStore) {
    throw new Error("analysisStore is required to persist reference items.");
  }

  return runtime.analysisStore.saveReferenceLibrary({
    providerMode: runtime.providerInfo.provider,
    result
  });
}

async function searchLawsWithPlan(
  runtime: RetrievalToolRuntime,
  plan: KeywordQueryPlan,
  limit: number,
  profileContext?: ProfileContext | null
): Promise<RetrievalSearchResult<LawDocumentRecord>> {
  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 10);
  const startedMs = Date.now();
  const records = await runtime.adapter.searchLaws(plan, normalizedLimit);
  const trace = [
    ...buildQueryPlanTrace(plan, runtime.providerInfo),
    buildTraceEvent(
      "law",
      "search_law_tool",
      runtime.providerInfo.provider,
      Date.now() - startedMs,
      `query:${plan.originalQuery}|context:${plan.contextType}|limit:${normalizedLimit}`,
      records.map((record) => buildLawReferenceKey(record.law_name, record.article_no)),
      `Returned ${records.length} law matches. provider_source=${runtime.providerInfo.source}`,
      false,
      plan.lawQueryRefs ?? []
    )
  ];

  return {
    provider: runtime.providerInfo.provider,
    records,
    retrieval_preview: buildSearchPreview("law", records, plan, runtime.providerInfo, profileContext),
    retrieval_trace: trace
  };
}

async function searchPrecedentsWithPlan(
  runtime: RetrievalToolRuntime,
  plan: KeywordQueryPlan,
  limit: number,
  profileContext?: ProfileContext | null
): Promise<RetrievalSearchResult<PrecedentDocumentRecord>> {
  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 10);
  const startedMs = Date.now();
  const records = await runtime.adapter.searchPrecedents(plan, normalizedLimit);
  const trace = [
    ...buildQueryPlanTrace(plan, runtime.providerInfo),
    buildTraceEvent(
      "precedent",
      "search_precedent_tool",
      runtime.providerInfo.provider,
      Date.now() - startedMs,
      `query:${plan.originalQuery}|context:${plan.contextType}|limit:${normalizedLimit}`,
      records.map((record) => buildPrecedentReferenceKey(record.case_no)),
      `Returned ${records.length} precedent matches. provider_source=${runtime.providerInfo.source}`,
      false,
      plan.precedentQueryRefs ?? []
    )
  ];

  return {
    provider: runtime.providerInfo.provider,
    records,
    retrieval_preview: buildSearchPreview("precedent", records, plan, runtime.providerInfo, profileContext),
    retrieval_trace: trace
  };
}

async function getLawDetailToolWithRuntime(
  runtime: RetrievalToolRuntime,
  request: RetrievalToolDetailRequest
): Promise<RetrievalToolDetailResponse> {
  if (!runtime.analysisStore) {
    const error = new Error("analysisStore is required for law detail lookup.") as HttpError;
    error.status = 500;
    throw error;
  }

  const lawId = requireString(request.law_id, "law_id field is required.");
  const item = await runtime.analysisStore.getReferenceByKindAndId("law", lawId);
  if (!item) {
    const error = new Error("Law reference not found.") as HttpError;
    error.status = 404;
    throw error;
  }

  return { item };
}

async function getPrecedentDetailToolWithRuntime(
  runtime: RetrievalToolRuntime,
  request: RetrievalToolDetailRequest
): Promise<RetrievalToolDetailResponse> {
  if (!runtime.analysisStore) {
    const error = new Error("analysisStore is required for precedent detail lookup.") as HttpError;
    error.status = 500;
    throw error;
  }

  const precedentId = requireString(request.precedent_id, "precedent_id field is required.");
  const item = await runtime.analysisStore.getReferenceByKindAndId("precedent", precedentId);
  if (!item) {
    const error = new Error("Precedent reference not found.") as HttpError;
    error.status = 404;
    throw error;
  }

  return { item };
}

function buildSearchResult(
  query: string,
  contextType: KeywordContextType,
  items: ReferenceLibraryItem[]
): RetrievalToolSearchResponse {
  return {
    query,
    context_type: contextType,
    count: items.length,
    items
  };
}

function extractContextType(request: AnalyzeRequestLike, ocr: OcrResultLike): KeywordContextType {
  const requested = String(request.context_type ?? "").trim();
  if (ALLOWED_CONTEXT_TYPES.has(requested as KeywordContextType)) {
    return requested as KeywordContextType;
  }

  const inferred = String((ocr as Record<string, unknown>).source_type ?? "").trim();
  if (ALLOWED_CONTEXT_TYPES.has(inferred as KeywordContextType)) {
    return inferred as KeywordContextType;
  }

  return "other";
}

function buildAnalysisSourceText(request: AnalyzeRequestLike, ocr: OcrResultLike): string {
  const utteranceText = Array.isArray(ocr.utterances)
    ? ocr.utterances
      .map((item) => normalizeText((item as Record<string, unknown>).text))
      .filter(Boolean)
      .join(" ")
    : "";

  return normalizeText([
    request.text,
    request.url,
    ocr.raw_text,
    utteranceText
  ].join(" "));
}

function uniqueTraceEvents(events: RetrievalTraceEvent[]): RetrievalTraceEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [
      event.stage,
      event.tool,
      event.input_ref,
      event.output_ref.join("|")
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function listTools(): RetrievalToolListResponse {
  return { tools: TOOL_DESCRIPTIONS };
}

export async function searchLawTool(
  deps: RetrievalToolDeps,
  request: RetrievalToolSearchRequest
): Promise<RetrievalToolSearchResponse> {
  return createRetrievalTools(deps).searchLawTool(request);
}

export async function searchPrecedentTool(
  deps: RetrievalToolDeps,
  request: RetrievalToolSearchRequest
): Promise<RetrievalToolSearchResponse> {
  return createRetrievalTools(deps).searchPrecedentTool(request);
}

export async function getLawDetailTool(
  deps: RetrievalToolDeps,
  request: RetrievalToolDetailRequest
): Promise<RetrievalToolDetailResponse> {
  return createRetrievalTools(deps).getLawDetailTool(request);
}

export async function getPrecedentDetailTool(
  deps: RetrievalToolDeps,
  request: RetrievalToolDetailRequest
): Promise<RetrievalToolDetailResponse> {
  return createRetrievalTools(deps).getPrecedentDetailTool(request);
}

export function createRetrievalTools(deps: RetrievalToolDeps) {
  const runtime = createToolRuntime(deps);

  return {
    listTools,
    buildQueryPlan(
      query: string,
      contextType: KeywordContextType,
      profileContext?: ProfileContext
    ): KeywordQueryPlan {
      return buildKeywordQueryPlan(query, contextType, profileContext);
    },
    buildAnalysisPlan(
      request: AnalyzeRequestLike,
      ocr: OcrResultLike,
      classification: ClassificationResultLike,
      profileContext?: ProfileContext | null
    ): KeywordQueryPlan {
      return buildAnalysisRetrievalPlan(
        classification,
        extractContextType(request, ocr),
        profileContext ?? undefined,
        buildAnalysisSourceText(request, ocr) || normalizeText(request.request_id)
      );
    },
    async searchLaws(limit: number, plan: KeywordQueryPlan, profileContext?: ProfileContext | null) {
      const result = await searchLawsWithPlan(runtime, plan, limit, profileContext);
      return {
        provider: result.provider,
        laws: result.records,
        retrieval_preview: result.retrieval_preview,
        retrieval_trace: result.retrieval_trace
      };
    },
    async searchPrecedents(limit: number, plan: KeywordQueryPlan, profileContext?: ProfileContext | null) {
      const result = await searchPrecedentsWithPlan(runtime, plan, limit, profileContext);
      return {
        provider: result.provider,
        precedents: result.records,
        retrieval_preview: result.retrieval_preview,
        retrieval_trace: result.retrieval_trace
      };
    },
    async materializeReferences(result: Record<string, unknown>) {
      return materializeReferenceItems(runtime, result);
    },
    buildCombinedRetrievalMeta(input: {
      law_search?: { retrieval_preview?: RetrievalPreview | null; retrieval_trace?: RetrievalTraceEvent[] };
      precedent_search?: { retrieval_preview?: RetrievalPreview | null; retrieval_trace?: RetrievalTraceEvent[] };
    }) {
      return {
        retrieval_preview: {
          law: input.law_search?.retrieval_preview ?? null,
          precedent: input.precedent_search?.retrieval_preview ?? null
        },
        retrieval_trace: uniqueTraceEvents([
          ...(Array.isArray(input.law_search?.retrieval_trace) ? input.law_search.retrieval_trace : []),
          ...(Array.isArray(input.precedent_search?.retrieval_trace) ? input.precedent_search.retrieval_trace : [])
        ])
      };
    },
    async searchLawTool(request: RetrievalToolSearchRequest): Promise<RetrievalToolSearchResponse> {
      const query = requireString(request.query, "query field is required.");
      const contextType = parseContextType(request.context_type);
      const limit = parseLimit(request.limit, 5, 10);
      const profileContext = buildProfileContext(
        await resolveProfileContext(runtime, request.token ?? null, request.profile_context)
      ) ?? undefined;
      const plan = buildKeywordQueryPlan(query, contextType, profileContext);
      const lawSearch = await searchLawsWithPlan(runtime, plan, limit, profileContext);
      const items = await materializeReferenceItems(runtime, { law_search: { laws: lawSearch.records } });
      return buildSearchResult(query, contextType, items);
    },
    async searchPrecedentTool(request: RetrievalToolSearchRequest): Promise<RetrievalToolSearchResponse> {
      const query = requireString(request.query, "query field is required.");
      const contextType = parseContextType(request.context_type);
      const limit = parseLimit(request.limit, 5, 10);
      const profileContext = buildProfileContext(
        await resolveProfileContext(runtime, request.token ?? null, request.profile_context)
      ) ?? undefined;
      const plan = buildKeywordQueryPlan(query, contextType, profileContext);
      const precedentSearch = await searchPrecedentsWithPlan(runtime, plan, limit, profileContext);
      const items = await materializeReferenceItems(runtime, {
        precedent_search: { precedents: precedentSearch.records }
      });
      return buildSearchResult(query, contextType, items);
    },
    async getLawDetailTool(request: RetrievalToolDetailRequest): Promise<RetrievalToolDetailResponse> {
      return getLawDetailToolWithRuntime(runtime, request);
    },
    async getPrecedentDetailTool(request: RetrievalToolDetailRequest): Promise<RetrievalToolDetailResponse> {
      return getPrecedentDetailToolWithRuntime(runtime, request);
    },
    async saveReferenceLibrary(result: Record<string, unknown>) {
      return materializeReferenceItems(runtime, result);
    }
  };
}

export type RetrievalTools = ReturnType<typeof createRetrievalTools>;

