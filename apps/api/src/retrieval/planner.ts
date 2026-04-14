import type { KeywordVerificationPlan, PlannedIssue, RetrievalProviderMode } from "./types.js";

interface IssueCatalogEntry {
  type: string;
  severity: "low" | "medium" | "high";
  criminal: boolean;
  civil: boolean;
  charge_label: string;
  keywords: string[];
  law_search_queries: string[];
}

function toTokens(query: string): string[] {
  return [...new Set(
    query
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  )] as string[];
}

function scoreIssue(issue: IssueCatalogEntry, normalizedQuery: string): PlannedIssue | null {
  const matchedKeywords = issue.keywords.filter((keyword) => normalizedQuery.includes(keyword.toLowerCase()));
  const matchedQueries = issue.law_search_queries.filter((keyword) => normalizedQuery.includes(keyword.toLowerCase()));
  if (matchedKeywords.length === 0 && matchedQueries.length === 0 && !normalizedQuery.includes(issue.type.toLowerCase())) {
    return null;
  }

  return {
    type: issue.type,
    severity: issue.severity,
    criminal: issue.criminal,
    civil: issue.civil,
    chargeLabel: issue.charge_label,
    matchedKeywords: [...new Set([...matchedKeywords, ...matchedQueries])],
    lawSearchQueries: [...new Set([issue.type, ...issue.law_search_queries])]
  };
}

async function loadIssueCatalog(): Promise<{
  ISSUE_CATALOG: IssueCatalogEntry[];
  normalizeText(value: unknown): string;
}> {
  // @ts-expect-error Legacy runtime module is still implemented in .mjs.
  const module = await import("../lib/issue-catalog.mjs");
  return module as {
    ISSUE_CATALOG: IssueCatalogEntry[];
    normalizeText(value: unknown): string;
  };
}

export async function planKeywordVerification(input: {
  query: string;
  contextType: string;
  providerMode: RetrievalProviderMode;
  limit: number;
}): Promise<KeywordVerificationPlan> {
  const { ISSUE_CATALOG, normalizeText } = await loadIssueCatalog();
  const normalizedQuery = normalizeText(input.query);
  const tokens = toTokens(normalizedQuery);
  const matchedIssues = ISSUE_CATALOG.map((issue) => scoreIssue(issue, normalizedQuery)).filter(Boolean) as PlannedIssue[];
  const searchQueries = [
    ...tokens,
    ...matchedIssues.flatMap((issue) => issue.lawSearchQueries),
    ...matchedIssues.flatMap((issue) => issue.matchedKeywords)
  ];

  const uniqueQueries = [...new Set(searchQueries)].filter(Boolean) as string[];
  const rationale =
    matchedIssues.length > 0
      ? `입력어가 ${matchedIssues.map((issue) => issue.type).join(", ")} 계열 이슈와 맞닿아 있습니다.`
      : "명시적 이슈 일치는 없어서 일반 키워드 검색으로 확장합니다.";

  return {
    query: input.query,
    normalizedQuery,
    contextType: input.contextType,
    providerMode: input.providerMode,
    limit: input.limit,
    tokens,
    matchedIssues,
    searchQueries: uniqueQueries.length > 0 ? uniqueQueries : tokens,
    rationale
  };
}
