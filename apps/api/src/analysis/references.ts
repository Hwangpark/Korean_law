import {
  buildLawReferenceKey,
  buildPrecedentReferenceKey,
  buildReferenceHref
} from "./reference-keys.mjs";

export type ReferenceKind = "law" | "precedent";
export type ReferenceAuthorityTier = "statute" | "constitutional_court" | "supreme_court" | "high_court" | "trial_court" | "unknown";
export type ReferenceFreshnessStatus = "current" | "historical" | "unknown";

export interface ReferenceSeed {
  kind: ReferenceKind;
  sourceKey: string;
  sourceMode: string;
  title: string;
  subtitle: string;
  summary: string;
  details: string;
  url: string | null;
  articleNo: string | null;
  caseNo: string | null;
  court: string | null;
  verdict: string | null;
  penalty: string | null;
  similarityScore: number | null;
  officialSourceLabel?: string | null;
  authorityTier?: ReferenceAuthorityTier;
  referenceDate?: string | null;
  freshnessStatus?: ReferenceFreshnessStatus;
  keywords: string[];
  payload: Record<string, unknown>;
  searchText: string;
}

export interface ReferenceLibraryItem {
  id: string;
  kind: ReferenceKind;
  href: string;
  title: string;
  subtitle: string;
  summary: string;
  details: string;
  url: string | null;
  articleNo: string | null;
  caseNo: string | null;
  court: string | null;
  verdict: string | null;
  penalty: string | null;
  similarityScore: number | null;
  sourceMode: string;
  officialSourceLabel?: string | null;
  authorityTier?: ReferenceAuthorityTier;
  referenceDate?: string | null;
  freshnessStatus?: ReferenceFreshnessStatus;
  keywords: string[];
  caseId: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceDetailItem extends ReferenceLibraryItem {
  payload: Record<string, unknown>;
  searchText: string;
}

export interface MaterializeReferenceSeedOptions {
  caseId?: string | null;
  runId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReferenceRow {
  kind: ReferenceKind;
  source_key: string;
  case_id: string | null;
  run_id: string | null;
  source_mode: string;
  title: string;
  subtitle: string | null;
  summary: string;
  details: string;
  url: string | null;
  article_no: string | null;
  case_no: string | null;
  court: string | null;
  verdict: string | null;
  penalty: string | null;
  similarity_score: number | string | null;
  keywords: string[] | string | null;
  payload_json: Record<string, unknown> | null;
  search_text: string;
  created_at: string;
  updated_at: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function collectKeywords(...values: unknown[]): string[] {
  return unique(values.flatMap((value) => toStringArray(value)));
}

function buildSearchText(...values: unknown[]): string {
  return collectKeywords(...values).join(" ");
}

function limitText(value: unknown, maxLength = 240): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === "object" && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDateText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function inferAuthorityTier(kind: ReferenceKind, court: string | null): ReferenceAuthorityTier {
  if (kind === "law") {
    return "statute";
  }

  const normalizedCourt = normalizeText(court).toLowerCase();
  if (!normalizedCourt) {
    return "unknown";
  }
  if (normalizedCourt.includes("헌법재판소")) {
    return "constitutional_court";
  }
  if (normalizedCourt.includes("대법원")) {
    return "supreme_court";
  }
  if (normalizedCourt.includes("고등법원") || normalizedCourt.includes("특허법원")) {
    return "high_court";
  }
  if (normalizedCourt.includes("지방법원") || normalizedCourt.includes("가정법원") || normalizedCourt.includes("행정법원") || normalizedCourt.includes("회생법원")) {
    return "trial_court";
  }
  return "unknown";
}

function inferOfficialSourceLabel(kind: ReferenceKind, payload: Record<string, unknown>, court: string | null): string | null {
  if (kind === "law") {
    return normalizeText(
      payload.ministry_name
      ?? payload.competent_authority
      ?? payload.department
      ?? payload.ministry
      ?? "법제처 국가법령정보"
    ) || "법제처 국가법령정보";
  }

  return normalizeText(court) || "법원 판례";
}

function inferReferenceDate(kind: ReferenceKind, payload: Record<string, unknown>): string | null {
  if (kind === "law") {
    return asDateText(
      payload.effective_date
      ?? payload.effectiveDate
      ?? payload.promulgation_date
      ?? payload.promulgationDate
      ?? payload.date
    );
  }

  return asDateText(payload.decision_date ?? payload.date ?? payload.sentenced_at);
}

function inferFreshnessStatus(payload: Record<string, unknown>): ReferenceFreshnessStatus {
  const status = normalizeText(
    payload.freshness_status
    ?? payload.freshnessStatus
    ?? payload.temporal_status
    ?? payload.temporalStatus
    ?? payload.status
  ).toLowerCase();

  if (["current", "active", "현행"].includes(status)) {
    return "current";
  }
  if (["historical", "repealed", "archived", "과거", "구법"].includes(status)) {
    return "historical";
  }
  if (payload.is_historical === true || payload.isHistorical === true || payload.repealed === true) {
    return "historical";
  }
  if (payload.is_current === true || payload.isCurrent === true) {
    return "current";
  }

  return "unknown";
}

function inferSourceModeFromResult(result: Record<string, unknown>, fallbackSourceMode: string): string {
  const meta = asRecord(result.meta);
  const traceEntries = [
    ...(Array.isArray(meta.retrieval_trace) ? meta.retrieval_trace : []),
    ...(Array.isArray(asRecord(result.law_search).retrieval_trace) ? asRecord(result.law_search).retrieval_trace as unknown[] : []),
    ...(Array.isArray(asRecord(result.precedent_search).retrieval_trace) ? asRecord(result.precedent_search).retrieval_trace as unknown[] : [])
  ];

  for (const rawEntry of traceEntries) {
    const entry = asRecord(rawEntry);
    const reason = normalizeText(entry.reason).toLowerCase();
    if (reason.includes("provider_source=live_fallback")) {
      return "live_fallback";
    }
    if (reason.includes("provider_source=live")) {
      return "live";
    }
    if (reason.includes("provider_source=fixture")) {
      return "fixture";
    }
  }

  const normalizedFallback = normalizeText(fallbackSourceMode).toLowerCase();
  return normalizedFallback || "fixture";
}

function buildLawSeed(law: Record<string, unknown>, sourceMode: string): ReferenceSeed {
  const lawName = normalizeText(law.law_name);
  const articleNo = normalizeText(law.article_no);
  const articleTitle = normalizeText(law.article_title);
  const content = normalizeText(law.content);
  const penalty = normalizeText(law.penalty);
  const url = normalizeText(law.url);
  const topics = toStringArray(law.topics);
  const queries = toStringArray(law.queries);
  const complaintRequired = Boolean(law["is_complaint_required"]);
  const normalizedLawName = lawName || "법령";
  const normalizedArticleNo = articleNo || "조문 미상";

  return {
    kind: "law",
    sourceKey: buildLawReferenceKey(normalizedLawName, normalizedArticleNo),
    sourceMode,
    title: `${normalizedLawName} ${normalizedArticleNo}`.trim(),
    subtitle: articleTitle || "법령 조문",
    summary: content || penalty || `${normalizedLawName} ${normalizedArticleNo}`.trim(),
    details: [
      content,
      penalty ? `처벌: ${penalty}` : "",
      complaintRequired ? "친고죄 여부: 고소 필요" : "",
      url ? `원문: ${url}` : ""
    ].filter(Boolean).join("\n"),
    url: url || null,
    articleNo: normalizedArticleNo || null,
    caseNo: null,
    court: null,
    verdict: null,
    penalty: penalty || null,
    similarityScore: null,
    officialSourceLabel: inferOfficialSourceLabel("law", law, null),
    authorityTier: inferAuthorityTier("law", null),
    referenceDate: inferReferenceDate("law", law),
    freshnessStatus: inferFreshnessStatus(law),
    keywords: collectKeywords(lawName, articleNo, articleTitle, content, penalty, topics, queries),
    payload: law,
    searchText: buildSearchText(
      lawName,
      articleNo,
      articleTitle,
      content,
      penalty,
      topics,
      queries
    )
  };
}

function buildPrecedentSeed(precedent: Record<string, unknown>, sourceMode: string): ReferenceSeed {
  const caseNo = normalizeText(precedent.case_no);
  const court = normalizeText(precedent.court);
  const date = normalizeText(precedent.date);
  const summary = normalizeText(precedent.summary);
  const verdict = normalizeText(precedent.verdict);
  const sentence = normalizeText(precedent.sentence);
  const reasoning = normalizeText(precedent.key_reasoning);
  const url = normalizeText(precedent.url);
  const topics = toStringArray(precedent.topics);
  const similarityScore = asNumber(precedent.similarity_score);
  const normalizedCaseNo = caseNo || "사건번호 미상";
  const normalizedCourt = court || "법원 미상";

  return {
    kind: "precedent",
    sourceKey: buildPrecedentReferenceKey(normalizedCaseNo),
    sourceMode,
    title: [normalizedCaseNo, normalizedCourt].filter(Boolean).join(" "),
    subtitle: [verdict, date].filter(Boolean).join(" · ") || "판례",
    summary: summary || reasoning || sentence || normalizedCaseNo,
    details: [
      summary,
      reasoning ? `판시사항: ${reasoning}` : "",
      sentence ? `선고: ${sentence}` : "",
      url ? `원문: ${url}` : ""
    ].filter(Boolean).join("\n"),
    url: url || null,
    articleNo: null,
    caseNo: normalizedCaseNo || null,
    court: normalizedCourt || null,
    verdict: verdict || null,
    penalty: sentence || null,
    similarityScore,
    officialSourceLabel: inferOfficialSourceLabel("precedent", precedent, normalizedCourt || null),
    authorityTier: inferAuthorityTier("precedent", normalizedCourt || null),
    referenceDate: inferReferenceDate("precedent", precedent),
    freshnessStatus: inferFreshnessStatus(precedent),
    keywords: collectKeywords(caseNo, court, date, summary, verdict, sentence, reasoning, topics),
    payload: precedent,
    searchText: buildSearchText(
      caseNo,
      court,
      date,
      summary,
      verdict,
      sentence,
      reasoning,
      topics
    )
  };
}

export function buildReferenceSeeds(result: Record<string, unknown>, sourceMode: string): ReferenceSeed[] {
  const inferredSourceMode = inferSourceModeFromResult(result, sourceMode);
  const lawSearch = asRecord(result.law_search);
  const precedentSearch = asRecord(result.precedent_search);
  const laws = Array.isArray(lawSearch.laws) ? lawSearch.laws.map((law) => asRecord(law)) : [];
  const precedents = Array.isArray(precedentSearch.precedents) ? precedentSearch.precedents.map((precedent) => asRecord(precedent)) : [];

  return [
    ...laws.map((law) => buildLawSeed(law, inferredSourceMode)),
    ...precedents.map((precedent) => buildPrecedentSeed(precedent, inferredSourceMode))
  ];
}

export function materializeReferenceSeed(
  seed: ReferenceSeed,
  options: MaterializeReferenceSeedOptions = {}
): ReferenceLibraryItem {
  const createdAt = options.createdAt ?? new Date(0).toISOString();
  const updatedAt = options.updatedAt ?? createdAt;

  return {
    id: seed.sourceKey,
    kind: seed.kind,
    href: buildReferenceHref(seed.kind, seed.sourceKey),
    title: seed.title,
    subtitle: seed.subtitle,
    summary: seed.summary,
    details: seed.details,
    url: seed.url,
    articleNo: seed.articleNo,
    caseNo: seed.caseNo,
    court: seed.court,
    verdict: seed.verdict,
    penalty: seed.penalty,
    similarityScore: seed.similarityScore,
    sourceMode: seed.sourceMode,
    officialSourceLabel: seed.officialSourceLabel ?? null,
    authorityTier: seed.authorityTier ?? "unknown",
    referenceDate: seed.referenceDate ?? null,
    freshnessStatus: seed.freshnessStatus ?? "unknown",
    keywords: seed.keywords,
    caseId: options.caseId ?? null,
    runId: options.runId ?? null,
    createdAt,
    updatedAt
  };
}

export function mapReferenceRow(row: ReferenceRow): ReferenceLibraryItem {
  const payload = row.payload_json ?? {};
  return {
    id: row.source_key,
    kind: row.kind,
    href: buildReferenceHref(row.kind, row.source_key),
    title: row.title,
    subtitle: row.subtitle ?? "",
    summary: row.summary,
    details: row.details,
    url: row.url,
    articleNo: row.article_no,
    caseNo: row.case_no,
    court: row.court,
    verdict: row.verdict,
    penalty: row.penalty,
    similarityScore: asNumber(row.similarity_score),
    sourceMode: row.source_mode,
    officialSourceLabel: inferOfficialSourceLabel(row.kind, payload, row.court),
    authorityTier: inferAuthorityTier(row.kind, row.court),
    referenceDate: inferReferenceDate(row.kind, payload),
    freshnessStatus: inferFreshnessStatus(payload),
    keywords: toStringArray(row.keywords),
    caseId: row.case_id,
    runId: row.run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapReferenceDetailRow(row: ReferenceRow): ReferenceDetailItem {
  return {
    ...mapReferenceRow(row),
    payload: row.payload_json ?? {},
    searchText: row.search_text
  };
}

export function normalizeReferenceQuery(query: string): string[] {
  return unique(
    String(query ?? "")
      .trim()
      .split(/\s+/)
      .map((part) => normalizeText(part))
      .filter((part) => part.length > 0)
  );
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function buildReferenceSnippet(item: Pick<ReferenceLibraryItem, "summary" | "details">, maxLength = 220): string {
  return limitText(item.summary || item.details, maxLength);
}
