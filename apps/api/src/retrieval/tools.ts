import type { AuthService } from "../auth/service.js";
import { buildProfileContext } from "../analysis/profile-context.js";
import type { ReferenceLibraryItem } from "../analysis/references.js";
import type { AnalysisStore } from "../analysis/store.js";
import { createRetrievalAdapter, type RetrievalAdapter } from "./mcp-adapter.js";
import { buildAnalysisRetrievalPlan, buildKeywordQueryPlan } from "./planner.js";
import type {
  KeywordContextType,
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  ProfileContext,
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
    description: "입력어와 문맥에 맞는 관련 법령을 검색합니다.",
    parameters: {
      query: "string",
      context_type: "community|game_chat|messenger|other",
      limit: "number"
    }
  },
  {
    name: "get_law_detail_tool",
    description: "search_law_tool 결과에서 받은 law_id로 법령 상세를 조회합니다.",
    parameters: {
      law_id: "string"
    }
  },
  {
    name: "search_precedent_tool",
    description: "입력어와 문맥에 맞는 유사 판례를 검색합니다.",
    parameters: {
      query: "string",
      context_type: "community|game_chat|messenger|other",
      limit: "number"
    }
  },
  {
    name: "get_precedent_detail_tool",
    description: "search_precedent_tool 결과에서 받은 precedent_id로 판례 상세를 조회합니다.",
    parameters: {
      precedent_id: "string"
    }
  }
];

function createToolRuntime(deps: RetrievalToolDeps): RetrievalToolRuntime {
  return {
    ...deps,
    adapter: createRetrievalAdapter(deps.providerMode)
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
    flags.push(`${profileContext.ageYears}세`);
  }

  if (profileContext.isMinor) {
    flags.push("미성년자");
  }

  if (profileContext.nationality === "foreign") {
    flags.push("외국인");
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
  providerMode: string,
  profileContext?: ProfileContext | null
): RetrievalPreview {
  const headline = plan.candidateIssues[0]
    ? `"${plan.originalQuery}" 는 ${plan.candidateIssues[0].type} 쟁점 기준으로 ${kind === "law" ? "법령" : "판례"}를 먼저 조회했습니다.`
    : `"${plan.originalQuery}" 에 대한 ${kind === "law" ? "법령" : "판례"} 후보를 먼저 조회했습니다.`;
  const disclaimer = providerMode === "live"
    ? "공식 API 조회 결과를 우선 사용했고, 부족한 경우 저장된 참조 라이브러리로 보강했습니다."
    : "mock fixture 조회 결과를 기준으로 tool chain을 미리 검증한 상태입니다.";

  const topLaws = kind === "law"
    ? (records as LawDocumentRecord[]).slice(0, 3).map((record) => ({
        id: buildPreviewCardId("law", `${record.law_name} ${record.article_no}`.trim(), record.article_no),
        title: `${record.law_name} ${record.article_no}`.trim(),
        summary: record.article_title || record.content || record.penalty || "관련 조문"
      }))
    : [];
  const topPrecedents = kind === "precedent"
    ? (records as PrecedentDocumentRecord[]).slice(0, 3).map((record) => ({
        id: buildPreviewCardId("precedent", record.case_no, record.case_no),
        title: `${record.case_no} ${record.court}`.trim(),
        summary: record.summary || record.key_reasoning || record.verdict || "유사 판례"
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
  cacheHit = false
): RetrievalTraceEvent {
  return {
    stage,
    tool,
    provider,
    duration_ms: durationMs,
    cache_hit: cacheHit,
    input_ref: inputRef,
    output_ref: outputRef,
    reason
  };
}

function buildQueryPlanTrace(
  plan: KeywordQueryPlan,
  providerMode: string,
  tool = "build_query_plan"
): RetrievalTraceEvent[] {
  return [
    buildTraceEvent(
      "planner",
      tool,
      providerMode,
      0,
      `query:${plan.originalQuery}`,
      plan.candidateIssues.map((issue) => issue.type),
      `${plan.candidateIssues.length}개 쟁점을 기준으로 질의를 확장했습니다.`
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
    providerMode: runtime.providerMode,
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
    ...buildQueryPlanTrace(plan, runtime.providerMode),
    buildTraceEvent(
      "law",
      "search_law_tool",
      runtime.providerMode,
      Date.now() - startedMs,
      `query:${plan.originalQuery}|context:${plan.contextType}|limit:${normalizedLimit}`,
      records.map((record) => `law:${record.law_name}:${record.article_no}`),
      `${records.length}건의 법령 후보를 반환했습니다.`
    )
  ];

  return {
    provider: runtime.providerMode,
    records,
    retrieval_preview: buildSearchPreview("law", records, plan, runtime.providerMode, profileContext),
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
    ...buildQueryPlanTrace(plan, runtime.providerMode),
    buildTraceEvent(
      "precedent",
      "search_precedent_tool",
      runtime.providerMode,
      Date.now() - startedMs,
      `query:${plan.originalQuery}|context:${plan.contextType}|limit:${normalizedLimit}`,
      records.map((record) => `precedent:${record.case_no}`),
      `${records.length}건의 판례 후보를 반환했습니다.`
    )
  ];

  return {
    provider: runtime.providerMode,
    records,
    retrieval_preview: buildSearchPreview("precedent", records, plan, runtime.providerMode, profileContext),
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
