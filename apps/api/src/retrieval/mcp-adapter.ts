import type {
  EvidenceQueryRef,
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  QueryProvenanceRef,
  RetrievalAdapterProviderInfo,
  RetrievalEvidenceSeed
} from "./types.js";
import { selectBestEvidenceSnippet } from "./snippets.js";
import {
  buildLawReferenceKey,
  buildPrecedentReferenceKey
} from "../analysis/reference-keys.mjs";
import { limitEvidenceText } from "../analysis/evidence-shared.mjs";

type LegacyJsonModule = {
  loadRepoJson: (relativePath: string) => Promise<unknown>;
};

interface LawFixtureRecord extends LawDocumentRecord {
  topics: string[];
  queries: string[];
}

interface PrecedentFixtureRecord extends PrecedentDocumentRecord {
  topics: string[];
}

export interface RetrievalAdapter {
  providerInfo: RetrievalAdapterProviderInfo;
  searchLaws(plan: KeywordQueryPlan, limit: number): Promise<LawDocumentRecord[]>;
  searchPrecedents(plan: KeywordQueryPlan, limit: number): Promise<PrecedentDocumentRecord[]>;
}

export interface RetrievalLiveProvider {
  searchLaws(input: {
    plan: KeywordQueryPlan;
    limit: number;
    fixtureSeeds: LawDocumentRecord[];
  }): Promise<Array<Partial<LawDocumentRecord>>>;
  searchPrecedents(input: {
    plan: KeywordQueryPlan;
    limit: number;
    fixtureSeeds: PrecedentDocumentRecord[];
  }): Promise<Array<Partial<PrecedentDocumentRecord>>>;
}

export interface RetrievalAdapterConfig {
  providerMode: string;
  liveProvider?: RetrievalLiveProvider | null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function includesAny(text: string, queries: string[]): boolean {
  return queries.some((query) => {
    const normalizedQuery = normalizeText(query);
    return normalizedQuery && (text.includes(normalizedQuery) || normalizedQuery.includes(text));
  });
}

function limitText(value: unknown, maxLength = 220): string {
  return limitEvidenceText(value, maxLength);
}

function buildMatchedQueries(
  searchable: string,
  channel: "law" | "precedent",
  preciseQueries: string[],
  broadQueries: string[],
  queryRefs: QueryProvenanceRef[] = []
): EvidenceQueryRef[] {
  const channelQueryRefs = queryRefs.filter((query) => query.channel === channel);
  const precisePool: QueryProvenanceRef[] = channelQueryRefs.length > 0
    ? channelQueryRefs.filter((query) => query.bucket === "precise")
    : preciseQueries.map((query) => ({
        text: query,
        bucket: "precise" as const,
        channel,
        sources: [],
        issue_types: [],
        legal_element_signals: []
      }));
  const preciseMatches = precisePool
    .filter((query) => includesAny(searchable, [query.text]))
    .map((query) => ({
      text: query.text,
      bucket: query.bucket,
      channel,
      ...(query.sources ? { sources: query.sources } : {}),
      ...(query.issue_types ? { issue_types: query.issue_types } : {}),
      ...(query.legal_element_signals ? { legal_element_signals: query.legal_element_signals } : {})
    }));
  const broadPool: QueryProvenanceRef[] = channelQueryRefs.length > 0
    ? channelQueryRefs.filter((query) => query.bucket === "broad")
    : broadQueries.map((query) => ({
        text: query,
        bucket: "broad" as const,
        channel,
        sources: [],
        issue_types: [],
        legal_element_signals: []
      }));
  const broadMatches = broadPool
    .filter((query) => !preciseMatches.some((match) => match.text === query.text) && includesAny(searchable, [query.text]))
    .map((query) => ({
      text: query.text,
      bucket: query.bucket,
      channel,
      ...(query.sources ? { sources: query.sources } : {}),
      ...(query.issue_types ? { issue_types: query.issue_types } : {}),
      ...(query.legal_element_signals ? { legal_element_signals: query.legal_element_signals } : {})
    }));

  return [...preciseMatches, ...broadMatches];
}

function buildMatchedIssueTypes(
  topics: string[],
  plan: KeywordQueryPlan
): string[] {
  return uniqueBy(
    topics.filter((topic) => plan.candidateIssues.some((issue) => issue.type === topic)),
    (topic) => topic
  );
}

function buildSpecificTerms(plan: KeywordQueryPlan): string[] {
  return [...new Set(
    plan.candidateIssues.flatMap((issue) => issue.matchedTerms).map((term) => normalizeText(term)).filter(Boolean)
  )];
}

function lawSearchText(record: LawFixtureRecord): string {
  return normalizeText(
    [
      record.law_name,
      record.article_no,
      record.article_title,
      record.content,
      record.penalty,
      ...record.topics,
      ...record.queries
    ].join(" ")
  );
}

function precedentSearchText(record: PrecedentFixtureRecord): string {
  return normalizeText(
    [
      record.case_no,
      record.court,
      record.summary,
      record.verdict,
      record.sentence,
      record.key_reasoning,
      ...record.topics
    ].join(" ")
  );
}

function hasStrongPrecedentMatch(record: PrecedentDocumentRecord | PrecedentFixtureRecord, plan: KeywordQueryPlan): boolean {
  const searchable = precedentSearchText(record as PrecedentFixtureRecord);
  const specificTerms = buildSpecificTerms(plan);
  if (includesAny(searchable, [plan.normalizedQuery, ...plan.tokens])) {
    return true;
  }
  return specificTerms.length > 0 && includesAny(searchable, specificTerms);
}

function normalizeAdapterConfig(input: string | RetrievalAdapterConfig): Required<RetrievalAdapterConfig> {
  if (typeof input === "string") {
    return {
      providerMode: input,
      liveProvider: null
    };
  }

  return {
    providerMode: input.providerMode,
    liveProvider: input.liveProvider ?? null
  };
}

function buildProviderInfo(config: Required<RetrievalAdapterConfig>): RetrievalAdapterProviderInfo {
  const requestedMode = String(config.providerMode || "mock").trim() || "mock";

  if (requestedMode !== "live") {
    return {
      requested_mode: requestedMode,
      provider: "mock",
      source: "fixture",
      live_enabled: false
    };
  }

  if (!config.liveProvider) {
    return {
      requested_mode: requestedMode,
      provider: "mock",
      source: "live_fallback",
      live_enabled: false,
      fallback_reason: "Live retrieval provider was not injected; using deterministic fixtures."
    };
  }

  return {
    requested_mode: requestedMode,
    provider: "live",
    source: "live",
    live_enabled: true
  };
}

async function loadLegacyJson(): Promise<LegacyJsonModule> {
  const mod = await import("../lib/load-json.mjs");
  return mod as unknown as LegacyJsonModule;
}

async function loadLawFixtures(): Promise<LawFixtureRecord[]> {
  const { loadRepoJson } = await loadLegacyJson();
  return (await loadRepoJson("fixtures/providers/laws.json")) as LawFixtureRecord[];
}

async function loadPrecedentFixtures(): Promise<PrecedentFixtureRecord[]> {
  const { loadRepoJson } = await loadLegacyJson();
  return (await loadRepoJson("fixtures/providers/precedents.json")) as PrecedentFixtureRecord[];
}

function selectLawFixtures(fixtures: LawFixtureRecord[], plan: KeywordQueryPlan): LawFixtureRecord[] {
  const issueTypes = new Set(plan.candidateIssues.map((issue) => issue.type));
  const searchQueries = [
    ...plan.preciseLawQueries,
    ...plan.broadLawQueries,
    ...plan.precisePrecedentQueries,
    ...plan.broadPrecedentQueries
  ];

  return fixtures.filter((record) => {
    const searchable = lawSearchText(record);
    return (
      record.topics.some((topic) => issueTypes.has(topic)) ||
      includesAny(searchable, searchQueries) ||
      record.queries.some((query) => includesAny(normalizeText(query), searchQueries))
    );
  });
}

function selectPrecedentFixtures(fixtures: PrecedentFixtureRecord[], plan: KeywordQueryPlan): PrecedentFixtureRecord[] {
  const issueTypes = new Set(plan.candidateIssues.map((issue) => issue.type));
  const searchQueries = [
    ...plan.precisePrecedentQueries,
    ...plan.broadPrecedentQueries,
    ...plan.preciseLawQueries,
    ...plan.broadLawQueries
  ];

  return fixtures.filter((record) => {
    const searchable = precedentSearchText(record);
    return (
      record.topics.some((topic) => issueTypes.has(topic)) ||
      includesAny(searchable, searchQueries)
    );
  });
}

function sanitizeLawRecord(record: Partial<LawDocumentRecord>): LawDocumentRecord {
  return {
    law_name: String(record.law_name ?? "").trim(),
    article_no: String(record.article_no ?? "").trim(),
    article_title: String(record.article_title ?? "").trim(),
    content: String(record.content ?? "").trim(),
    penalty: String(record.penalty ?? "").trim(),
    url: String(record.url ?? "").trim(),
    topics: Array.isArray(record.topics) ? record.topics.map((item) => String(item)) : [],
    queries: Array.isArray(record.queries) ? record.queries.map((item) => String(item)) : [],
    is_complaint_required: Boolean(record.is_complaint_required),
    ...(record.retrieval_evidence ? { retrieval_evidence: record.retrieval_evidence } : {})
  };
}

function sanitizePrecedentRecord(record: Partial<PrecedentDocumentRecord>): PrecedentDocumentRecord {
  return {
    case_no: String(record.case_no ?? "").trim(),
    court: String(record.court ?? "").trim(),
    date: String(record.date ?? "").trim(),
    summary: String(record.summary ?? "").trim(),
    verdict: String(record.verdict ?? "").trim(),
    sentence: String(record.sentence ?? "").trim(),
    key_reasoning: String(record.key_reasoning ?? "").trim(),
    url: String(record.url ?? "").trim(),
    topics: Array.isArray(record.topics) ? record.topics.map((item) => String(item)) : [],
    similarity_score: typeof record.similarity_score === "number" ? record.similarity_score : undefined,
    ...(record.retrieval_evidence ? { retrieval_evidence: record.retrieval_evidence } : {})
  };
}

function buildLawEvidenceSeed(
  record: LawFixtureRecord | LawDocumentRecord,
  plan: KeywordQueryPlan,
  provider: string
): RetrievalEvidenceSeed {
  const searchable = lawSearchText(record as LawFixtureRecord);
  const matchedQueries = buildMatchedQueries(
    searchable,
    "law",
    plan.preciseLawQueries,
    plan.broadLawQueries,
    plan.lawQueryRefs
  );
  const matchedIssueTypes = buildMatchedIssueTypes(record.topics ?? [], plan);
  const snippet = selectBestEvidenceSnippet({
    sources: [
      ...(record.content ? [{ field: "content" as const, text: record.content }] : []),
      ...(record.article_title ? [{ field: "article_title" as const, text: record.article_title }] : []),
      ...(record.penalty ? [{ field: "penalty" as const, text: record.penalty }] : [])
    ],
    matchedQueries,
    issueTypes: matchedIssueTypes
  });

  return {
    reference_key: buildLawReferenceKey(record.law_name, record.article_no),
    kind: "law" as const,
    provider,
    matched_queries: matchedQueries,
    matched_issue_types: matchedIssueTypes,
    snippet: snippet ?? {
      field: record.content ? "content" : record.article_title ? "article_title" : "penalty",
      text: limitText(record.content || record.article_title || record.penalty)
    }
  };
}

function buildPrecedentEvidenceSeed(
  record: PrecedentFixtureRecord | PrecedentDocumentRecord,
  plan: KeywordQueryPlan,
  provider: string
): RetrievalEvidenceSeed {
  const searchable = precedentSearchText(record as PrecedentFixtureRecord);
  const matchedQueries = buildMatchedQueries(
    searchable,
    "precedent",
    plan.precisePrecedentQueries,
    plan.broadPrecedentQueries,
    plan.precedentQueryRefs
  );
  const matchedIssueTypes = buildMatchedIssueTypes(record.topics ?? [], plan);
  const snippet = selectBestEvidenceSnippet({
    sources: [
      ...(record.summary ? [{ field: "summary" as const, text: record.summary }] : []),
      ...(record.key_reasoning ? [{ field: "key_reasoning" as const, text: record.key_reasoning }] : []),
      ...(record.sentence ? [{ field: "sentence" as const, text: record.sentence }] : [])
    ],
    matchedQueries,
    issueTypes: matchedIssueTypes
  });

  return {
    reference_key: buildPrecedentReferenceKey(record.case_no),
    kind: "precedent" as const,
    provider,
    matched_queries: matchedQueries,
    matched_issue_types: matchedIssueTypes,
    snippet: snippet ?? {
      field: record.summary ? "summary" : record.key_reasoning ? "key_reasoning" : "sentence",
      text: limitText(record.summary || record.key_reasoning || record.sentence)
    }
  };
}

export function createRetrievalAdapter(input: string | RetrievalAdapterConfig): RetrievalAdapter {
  const config = normalizeAdapterConfig(input);
  const providerInfo = buildProviderInfo(config);
  const provider = providerInfo.provider;

  return {
    providerInfo,

    async searchLaws(plan, limit) {
      const lawFixtures = selectLawFixtures(await loadLawFixtures(), plan).slice(0, Math.max(limit * 2, 6));
      const fixtureResults = uniqueBy(
        lawFixtures.slice(0, limit).map((record) => sanitizeLawRecord({
          ...record,
          retrieval_evidence: buildLawEvidenceSeed(record, plan, provider)
        })),
        (record) => `${record.law_name}:${record.article_no}`
      );

      if (!providerInfo.live_enabled || !config.liveProvider) {
        return fixtureResults;
      }

      const liveRecords = await config.liveProvider.searchLaws({
        plan,
        limit,
        fixtureSeeds: fixtureResults
      });
      const normalizedLiveRecords = uniqueBy(
        liveRecords.map((record) => {
          const sanitized = sanitizeLawRecord(record);
          return sanitizeLawRecord({
            ...sanitized,
            retrieval_evidence: buildLawEvidenceSeed(sanitized, plan, provider)
          });
        }),
        (record) => `${record.law_name}:${record.article_no}`
      );

      return uniqueBy([...normalizedLiveRecords, ...fixtureResults], (record) => `${record.law_name}:${record.article_no}`).slice(0, limit);
    },

    async searchPrecedents(plan, limit) {
      const fallbackFixtures = selectPrecedentFixtures(await loadPrecedentFixtures(), plan)
        .slice(0, Math.max(limit * 2, 6))
        .map((record, index) =>
          sanitizePrecedentRecord({
            ...record,
            similarity_score: Number(Math.max(0.4, 0.92 - index * 0.12).toFixed(2)),
            retrieval_evidence: buildPrecedentEvidenceSeed(record, plan, provider)
          })
        );

      if (!providerInfo.live_enabled || !config.liveProvider) {
        return uniqueBy(fallbackFixtures, (record) => record.case_no).slice(0, limit);
      }

      const liveRecords = await config.liveProvider.searchPrecedents({
        plan,
        limit,
        fixtureSeeds: fallbackFixtures
      });
      const liveResults = uniqueBy(
        liveRecords.map((record) => {
          const sanitized = sanitizePrecedentRecord(record);
          return sanitizePrecedentRecord({
            ...sanitized,
            retrieval_evidence: buildPrecedentEvidenceSeed(sanitized, plan, provider)
          });
        }),
        (record) => record.case_no
      );

      const strongLiveResults = liveResults.filter((record) => hasStrongPrecedentMatch(record, plan));

      if (buildSpecificTerms(plan).length > 0) {
        return uniqueBy(
          [
            ...strongLiveResults,
            ...fallbackFixtures,
            ...liveResults
          ],
          (record) => record.case_no
        ).slice(0, limit);
      }

      return (liveResults.length > 0 ? liveResults : fallbackFixtures).slice(0, limit);
    }
  };
}
