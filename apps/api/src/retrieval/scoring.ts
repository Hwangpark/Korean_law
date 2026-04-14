import type {
  KeywordVerificationPlan,
  LawCandidate,
  PrecedentCandidate,
  ScoredLawCandidate,
  ScoredPrecedentCandidate,
  RetrievalKind
} from "./types.js";

function normalizeText(value: string): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function overlap(a: string[], b: string[]): string[] {
  const lookup = new Set(b.map((value) => normalizeText(value)));
  return unique(a.filter((value) => lookup.has(normalizeText(value))));
}

function scoreToLabel(score: number): "strong" | "moderate" | "weak" {
  if (score >= 0.75) return "strong";
  if (score >= 0.45) return "moderate";
  return "weak";
}

function tokenize(value: string): string[] {
  return unique(
    normalizeText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  );
}

export function scoreLawCandidate(plan: KeywordVerificationPlan, law: LawCandidate): ScoredLawCandidate {
  const issueTokens = plan.matchedIssues.flatMap((issue) => [issue.type, ...issue.matchedKeywords, ...issue.lawSearchQueries]);
  const lawTokens = [
    law.law_name,
    law.article_no,
    law.article_title,
    law.content,
    law.penalty,
    ...law.topics,
    ...law.queries
  ];
  const matchedTerms = overlap([...tokenize(plan.normalizedQuery), ...issueTokens], lawTokens);
  const issueOverlap = overlap(plan.matchedIssues.map((issue) => issue.type), law.topics).length / Math.max(plan.matchedIssues.length, 1);
  const keywordOverlap = matchedTerms.length / Math.max(plan.searchQueries.length, 1);
  const score = Math.min(1, Number((0.35 + issueOverlap * 0.4 + keywordOverlap * 0.45).toFixed(2)));

  return {
    ...law,
    matchedTerms,
    score,
    relevance: scoreToLabel(score)
  };
}

export function scorePrecedentCandidate(
  plan: KeywordVerificationPlan,
  precedent: PrecedentCandidate
): ScoredPrecedentCandidate {
  const precedentTokens = [
    precedent.case_no,
    precedent.court,
    precedent.summary,
    precedent.verdict,
    precedent.sentence,
    precedent.key_reasoning,
    ...precedent.topics
  ];
  const matchedTerms = overlap(tokenize(plan.normalizedQuery).concat(plan.searchQueries), precedentTokens);
  const issueOverlap = overlap(plan.matchedIssues.map((issue) => issue.type), precedent.topics).length / Math.max(plan.matchedIssues.length, 1);
  const keywordOverlap = matchedTerms.length / Math.max(plan.searchQueries.length, 1);
  const similarityBase = Number.isFinite(precedent.similarity_score) ? precedent.similarity_score : 0;
  const score = Math.min(1, Number((0.2 + similarityBase * 0.45 + issueOverlap * 0.2 + keywordOverlap * 0.35).toFixed(2)));

  return {
    ...precedent,
    matchedTerms,
    score,
    relevance: scoreToLabel(score)
  };
}

export function summarizeVerification(
  plan: KeywordVerificationPlan,
  laws: ScoredLawCandidate[],
  precedents: ScoredPrecedentCandidate[]
): {
  summary: string;
  score: number;
  matched_issue_types: string[];
  focus: RetrievalKind[];
  recommended_keywords: string[];
} {
  const topLaw = laws[0];
  const topPrecedent = precedents[0];
  const bestScore = Math.max(topLaw?.score ?? 0, topPrecedent?.score ?? 0);
  const matchedIssueTypes = plan.matchedIssues.map((issue) => issue.type);
  const focus: RetrievalKind[] = [];
  if (laws.length > 0) focus.push("law");
  if (precedents.length > 0) focus.push("precedent");

  const recommendedKeywords = unique([
    ...plan.matchedIssues.flatMap((issue) => issue.lawSearchQueries),
    ...plan.matchedIssues.flatMap((issue) => issue.matchedKeywords),
    ...(topLaw?.matchedTerms ?? []),
    ...(topPrecedent?.matchedTerms ?? [])
  ]).slice(0, 12);

  const summary = bestScore >= 0.75
    ? "키워드와 법령/판례의 연결성이 높습니다."
    : bestScore >= 0.45
      ? "키워드와 관련 법령/판례가 일부 연결됩니다."
      : "키워드만으로는 일치가 약해 추가 사실관계가 필요합니다.";

  return {
    summary,
    score: Number(bestScore.toFixed(2)),
    matched_issue_types: matchedIssueTypes,
    focus,
    recommended_keywords: recommendedKeywords
  };
}
