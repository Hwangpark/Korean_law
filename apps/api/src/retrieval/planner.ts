import { findMatchedKeywords, normalizeText as normalizeSearchText } from "../lib/abuse-patterns.mjs";
import { CONTEXT_PRECEDENT_HINTS, RETRIEVAL_ISSUE_CATALOG } from "./catalog.js";
import type { CandidateIssue, KeywordContextType, KeywordQueryPlan, ProfileContext } from "./types.js";

function normalizeText(value: string): string {
  return normalizeSearchText(value);
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
      const matchedTerms = unique(
        findMatchedKeywords(normalizedQuery, issue.keywords).concat(
          ...tokens.map((token) => findMatchedKeywords(token, issue.keywords))
        )
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

function buildProfileAwareHints(profileContext?: ProfileContext): {
  lawQueries: string[];
  precedentQueries: string[];
  warnings: string[];
} {
  if (!profileContext) {
    return {
      lawQueries: [],
      precedentQueries: [],
      warnings: []
    };
  }

  const lawQueries: string[] = [];
  const precedentQueries: string[] = [];
  const warnings: string[] = [];

  if (profileContext.isMinor) {
    lawQueries.push("미성년자", "법정대리인");
    precedentQueries.push("미성년자 피해", "청소년 온라인 분쟁");
    warnings.push("미성년자 사안은 보호자 또는 법정대리인 동행 여부를 함께 확인해야 합니다.");
  }

  if (profileContext.ageBand === "child") {
    lawQueries.push("아동", "청소년");
    precedentQueries.push("아동 온라인 모욕", "청소년 게임 채팅");
  }

  if (profileContext.nationality === "foreign") {
    warnings.push("외국인 사용자는 신분 자료와 번역 필요 여부를 추가 확인하는 편이 안전합니다.");
  }

  return {
    lawQueries: unique(lawQueries),
    precedentQueries: unique(precedentQueries),
    warnings: unique(warnings.concat(profileContext.legalNotes ?? []))
  };
}

export function buildKeywordQueryPlan(
  query: string,
  contextType: KeywordContextType,
  profileContext?: ProfileContext
): KeywordQueryPlan {
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
  const profileHints = buildProfileAwareHints(profileContext);
  const lawQueries = unique([
    normalizedQuery,
    ...tokens,
    ...candidateIssues.flatMap((issue) => issue.lawQueries),
    ...profileHints.lawQueries
  ]);
  const precedentQueries = unique([
    normalizedQuery,
    ...tokens,
    ...candidateIssues.flatMap((issue) => issue.precedentQueries),
    ...profileHints.precedentQueries
  ]);
  warnings.push(...profileHints.warnings);

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
