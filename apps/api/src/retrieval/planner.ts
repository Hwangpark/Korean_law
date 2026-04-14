import { CONTEXT_PRECEDENT_HINTS, RETRIEVAL_ISSUE_CATALOG } from "./catalog.js";
import type { CandidateIssue, KeywordContextType, KeywordQueryPlan } from "./types.js";

function normalizeText(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function tokenize(value: string): string[] {
  return unique(
    normalizeText(value)
      .split(/[\s,./|]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function includesEither(left: string, right: string): boolean {
  return left.includes(right) || right.includes(left);
}

function buildReason(type: string, matchedTerms: string[], contextType: KeywordContextType): string {
  const matched = matchedTerms.length > 0
    ? `입력어가 ${matchedTerms.join(", ")} 표현과 겹칩니다.`
    : "유사 사건군으로 분류했습니다.";
  return `${type} 쟁점으로 검토합니다. ${matched} 맥락은 ${contextType} 로 반영했습니다.`;
}

function buildCandidateIssues(
  normalizedQuery: string,
  tokens: string[],
  contextType: KeywordContextType
): CandidateIssue[] {
  const issues = RETRIEVAL_ISSUE_CATALOG
    .map((issue) => {
      const matchedTerms = issue.keywords.filter((keyword) =>
        includesEither(normalizedQuery, normalizeText(keyword)) ||
        tokens.some((token) => includesEither(token, normalizeText(keyword)))
      );

      if (matchedTerms.length === 0) {
        return null;
      }

      const precedentQueries = unique([
        issue.type,
        ...issue.lawQueries,
        ...CONTEXT_PRECEDENT_HINTS[contextType].map((hint) => `${hint} ${issue.type}`)
      ]);

      return {
        type: issue.type,
        severity: issue.severity,
        matchedTerms,
        lawQueries: unique([...issue.lawQueries, issue.type]),
        precedentQueries,
        reason: buildReason(issue.type, matchedTerms, contextType)
      } satisfies CandidateIssue;
    })
    .filter((issue): issue is CandidateIssue => Boolean(issue));

  if (issues.length > 0) {
    return issues;
  }

  const fallbackQueries = unique([
    normalizedQuery,
    ...tokens,
    ...CONTEXT_PRECEDENT_HINTS[contextType].map((hint) => `${hint} ${normalizedQuery}`)
  ]);

  return [
    {
      type: "일반 키워드 검증",
      severity: "low",
      matchedTerms: tokens.length > 0 ? tokens : [normalizedQuery],
      lawQueries: fallbackQueries,
      precedentQueries: fallbackQueries,
      reason: "사전 분류되지 않은 표현이어서 일반 키워드 검색으로 확장합니다."
    }
  ];
}

export function buildKeywordQueryPlan(query: string, contextType: KeywordContextType): KeywordQueryPlan {
  const normalizedQuery = normalizeText(query);
  const tokens = tokenize(query);
  const warnings: string[] = [];

  if (normalizedQuery.length < 2) {
    warnings.push("입력어가 너무 짧아 검색 결과가 부정확할 수 있습니다.");
  }

  if (tokens.length === 1) {
    warnings.push("단어 하나만으로는 공연성, 반복성, 고의성 판단이 어렵습니다.");
  }

  const candidateIssues = buildCandidateIssues(normalizedQuery, tokens, contextType);
  const lawQueries = unique([
    normalizedQuery,
    ...tokens,
    ...candidateIssues.flatMap((issue) => issue.lawQueries)
  ]);
  const precedentQueries = unique([
    normalizedQuery,
    ...tokens,
    ...candidateIssues.flatMap((issue) => issue.precedentQueries)
  ]);

  return {
    originalQuery: query.trim(),
    normalizedQuery,
    contextType,
    tokens,
    candidateIssues,
    lawQueries,
    precedentQueries,
    warnings
  };
}
