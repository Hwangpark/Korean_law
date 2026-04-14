import type { KeywordVerificationPlan, LawCandidate, PrecedentCandidate, RetrievalProviderMode } from "./types.js";

const OFFICIAL_LAW_NAME_ALIASES: Record<string, string> = {
  형법: "형법",
  정보통신망법: "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
  개인정보보호법: "개인정보 보호법",
  "스토킹범죄의 처벌 등에 관한 법률": "스토킹범죄의 처벌 등에 관한 법률"
};

function normalizeText(value: string): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, values: string[]): boolean {
  const normalized = normalizeText(text);
  return values.some((value) => normalized.includes(normalizeText(value)));
}

function scoreOverlap(values: string[], plan: KeywordVerificationPlan): number {
  const normalizedTokens = new Set(plan.searchQueries.map((value) => normalizeText(value)));
  const matches = values.filter((value) => normalizedTokens.has(normalizeText(value)));
  return matches.length / Math.max(values.length, 1);
}

async function loadRepoHelpers(): Promise<{
  loadRepoJson(relativePath: string): Promise<unknown>;
  uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[];
}> {
  // @ts-expect-error Legacy runtime module is still implemented in .mjs.
  const module = await import("../lib/load-json.mjs");
  return module as {
    loadRepoJson(relativePath: string): Promise<unknown>;
    uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[];
  };
}

async function loadLawApiHelpers(): Promise<{
  fetchLawArticleByName(lawName: string, articleNo: string): Promise<Record<string, unknown> | null>;
  searchPrecedentsByQueries(
    queries: string[],
    topics: string[],
    limit?: number
  ): Promise<Record<string, unknown>[]>;
}> {
  // @ts-expect-error Legacy runtime module is still implemented in .mjs.
  const module = await import("../lib/law-open-api.mjs");
  return module as {
    fetchLawArticleByName(lawName: string, articleNo: string): Promise<Record<string, unknown> | null>;
    searchPrecedentsByQueries(
      queries: string[],
      topics: string[],
      limit?: number
    ): Promise<Record<string, unknown>[]>;
  };
}

function toLawCandidate(value: Record<string, unknown>, provider: RetrievalProviderMode): LawCandidate {
  return {
    law_name: String(value.law_name ?? ""),
    article_no: String(value.article_no ?? ""),
    article_title: String(value.article_title ?? ""),
    content: String(value.content ?? ""),
    penalty: String(value.penalty ?? ""),
    is_complaint_required: Boolean(value.is_complaint_required),
    url: String(value.url ?? ""),
    topics: Array.isArray(value.topics) ? value.topics.map((topic) => String(topic)) : [],
    queries: Array.isArray(value.queries) ? value.queries.map((query) => String(query)) : [],
    provider
  };
}

function toPrecedentCandidate(value: Record<string, unknown>, provider: RetrievalProviderMode): PrecedentCandidate {
  return {
    case_no: String(value.case_no ?? ""),
    court: String(value.court ?? ""),
    date: String(value.date ?? ""),
    summary: String(value.summary ?? ""),
    verdict: String(value.verdict ?? ""),
    sentence: String(value.sentence ?? ""),
    key_reasoning: String(value.key_reasoning ?? ""),
    similarity_score: Number(value.similarity_score ?? 0),
    url: String(value.url ?? ""),
    topics: Array.isArray(value.topics) ? value.topics.map((topic) => String(topic)) : [],
    provider
  };
}

async function loadLawFixtures(): Promise<LawCandidate[]> {
  const { loadRepoJson } = await loadRepoHelpers();
  const laws = await loadRepoJson("fixtures/providers/laws.json");
  const rows = Array.isArray(laws) ? (laws as Record<string, unknown>[]) : [];
  return rows.map((law) => toLawCandidate(law, "mock"));
}

async function loadPrecedentFixtures(): Promise<PrecedentCandidate[]> {
  const { loadRepoJson } = await loadRepoHelpers();
  const precedents = await loadRepoJson("fixtures/providers/precedents.json");
  const rows = Array.isArray(precedents) ? (precedents as Record<string, unknown>[]) : [];
  return rows.map((precedent) => toPrecedentCandidate(precedent, "mock"));
}

function filterLawFixtures(laws: LawCandidate[], plan: KeywordVerificationPlan): LawCandidate[] {
  const normalizedQueries = plan.searchQueries.map((query) => normalizeText(query));
  return laws.filter((law) => {
    const searchable = [
      law.law_name,
      law.article_no,
      law.article_title,
      law.content,
      law.penalty,
      ...law.topics,
      ...law.queries
    ];
    return searchable.some((value) => matchesAny(value, normalizedQueries));
  });
}

function filterPrecedentFixtures(precedents: PrecedentCandidate[], plan: KeywordVerificationPlan): PrecedentCandidate[] {
  const normalizedQueries = plan.searchQueries.map((query) => normalizeText(query));
  return precedents
    .map((precedent) => {
      const searchable = [
        precedent.case_no,
        precedent.court,
        precedent.summary,
        precedent.verdict,
        precedent.sentence,
        precedent.key_reasoning,
        ...precedent.topics
      ];
      const matched = searchable.some((value) => matchesAny(value, normalizedQueries));
      if (!matched) {
        return null;
      }

      const overlapScore = scoreOverlap(precedent.topics.length > 0 ? precedent.topics : normalizedQueries, plan);
      return {
        ...precedent,
        similarity_score: Number(Math.max(precedent.similarity_score ?? 0, overlapScore).toFixed(2))
      };
    })
    .filter((precedent): precedent is PrecedentCandidate => Boolean(precedent));
}

function uniqueLawKey(law: LawCandidate): string {
  return `${law.law_name}:${law.article_no}`;
}

export async function searchLawCandidates(
  plan: KeywordVerificationPlan
): Promise<LawCandidate[]> {
  const fixtures = await loadLawFixtures();
  const matched = filterLawFixtures(fixtures, plan);
  const { uniqueBy } = await loadRepoHelpers();

  if (plan.providerMode === "mock") {
    return uniqueBy(matched, uniqueLawKey).slice(0, plan.limit);
  }

  const { fetchLawArticleByName } = await loadLawApiHelpers();
  const hydrated = await Promise.all(
    uniqueBy(matched, uniqueLawKey).map(async (law) => {
      const officialLawName = OFFICIAL_LAW_NAME_ALIASES[law.law_name] ?? law.law_name;
      try {
        const article = await fetchLawArticleByName(officialLawName, law.article_no);
        if (!article) {
          return {
            ...law,
            provider: "live" as const
          };
        }

        return {
          ...law,
          ...article,
          provider: "live" as const
        };
      } catch {
        return {
          ...law,
          provider: "live" as const
        };
      }
    })
  );

  return hydrated.slice(0, plan.limit);
}

export async function searchPrecedentCandidates(
  plan: KeywordVerificationPlan
): Promise<PrecedentCandidate[]> {
  const fixturePrecedents = await loadPrecedentFixtures();

  if (plan.providerMode === "mock") {
    return filterPrecedentFixtures(fixturePrecedents, plan)
      .sort((left, right) => right.similarity_score - left.similarity_score)
      .slice(0, plan.limit);
  }

  const topics = plan.matchedIssues.flatMap((issue) => [issue.type, ...issue.lawSearchQueries]);
  const { searchPrecedentsByQueries } = await loadLawApiHelpers();
  const livePrecedents = await searchPrecedentsByQueries(plan.searchQueries, topics, plan.limit);
  return livePrecedents.map((precedent) => toPrecedentCandidate(precedent, "live"));
}
