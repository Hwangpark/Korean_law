import type {
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord
} from "./types.js";

type LegacyLawApiModule = {
  fetchLawArticleByName: (lawName: string, articleNo: string) => Promise<Record<string, unknown> | null>;
  searchPrecedentsByQueries: (
    queries: string[],
    topics: string[],
    limit?: number
  ) => Promise<Record<string, unknown>[]>;
};

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
  searchLaws(plan: KeywordQueryPlan, limit: number): Promise<LawDocumentRecord[]>;
  searchPrecedents(plan: KeywordQueryPlan, limit: number): Promise<PrecedentDocumentRecord[]>;
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

async function loadLegacyLawApi(): Promise<LegacyLawApiModule> {
  const mod = await import("../lib/law-open-api.mjs");
  return mod as unknown as LegacyLawApiModule;
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
  const searchQueries = [...plan.lawQueries, ...plan.precedentQueries];

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
  const searchQueries = [...plan.precedentQueries, ...plan.lawQueries];

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
    is_complaint_required: Boolean(record.is_complaint_required)
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
    similarity_score: typeof record.similarity_score === "number" ? record.similarity_score : undefined
  };
}

export function createRetrievalAdapter(providerMode: string): RetrievalAdapter {
  return {
    async searchLaws(plan, limit) {
      const lawFixtures = selectLawFixtures(await loadLawFixtures(), plan).slice(0, Math.max(limit * 2, 6));

      if (providerMode !== "live") {
        return uniqueBy(
          lawFixtures.slice(0, limit).map((record) => sanitizeLawRecord(record)),
          (record) => `${record.law_name}:${record.article_no}`
        );
      }

      const { fetchLawArticleByName } = await loadLegacyLawApi();
      const hydrated = await Promise.all(
        lawFixtures.map(async (record) => {
          try {
            const article = await fetchLawArticleByName(record.law_name, record.article_no);
            if (!article) {
              return sanitizeLawRecord(record);
            }

            return sanitizeLawRecord({
              ...record,
              ...article,
              topics: record.topics,
              queries: record.queries,
              is_complaint_required: record.is_complaint_required
            });
          } catch {
            return sanitizeLawRecord(record);
          }
        })
      );

      return uniqueBy(hydrated, (record) => `${record.law_name}:${record.article_no}`).slice(0, limit);
    },

    async searchPrecedents(plan, limit) {
      if (providerMode !== "live") {
        const fixtures = selectPrecedentFixtures(await loadPrecedentFixtures(), plan)
          .slice(0, Math.max(limit * 2, 6))
          .map((record, index) =>
            sanitizePrecedentRecord({
              ...record,
              similarity_score: Number(Math.max(0.4, 0.92 - index * 0.12).toFixed(2))
            })
          );

        return uniqueBy(fixtures, (record) => record.case_no).slice(0, limit);
      }

      const { searchPrecedentsByQueries } = await loadLegacyLawApi();
      const topics = plan.candidateIssues.map((issue) => issue.type);
      const precedents = await searchPrecedentsByQueries(
        plan.precedentQueries.slice(0, 6),
        topics,
        Math.max(limit, 3)
      );

      return uniqueBy(
        precedents.map((record) =>
          sanitizePrecedentRecord({
            ...record,
            topics
          })
        ),
        (record) => record.case_no
      ).slice(0, limit);
    }
  };
}
