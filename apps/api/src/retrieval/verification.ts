import type { ReferenceLibraryItem } from "../analysis/references.js";
import type {
  CandidateIssue,
  KeywordQueryPlan,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  VerifiedReferenceCard
} from "./types.js";

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function includesAny(text: string, queries: string[]): string[] {
  return queries.filter((query) => {
    const normalizedQuery = normalizeText(query);
    return normalizedQuery.length > 0 && text.includes(normalizedQuery);
  });
}

function clampScore(value: number): number {
  return Math.max(0.05, Math.min(0.99, Number(value.toFixed(2))));
}

function buildIssueLabels(candidateIssues: CandidateIssue[]): string[] {
  return candidateIssues
    .map((issue) => issue.type)
    .filter(Boolean);
}

function buildSpecificTerms(plan: KeywordQueryPlan): string[] {
  return [...new Set(
    plan.candidateIssues
      .flatMap((issue) => issue.matchedTerms)
      .filter((term) => term && !buildIssueLabels(plan.candidateIssues).includes(term))
  )];
}

function lawSearchText(law: LawDocumentRecord): string {
  return normalizeText(
    [
      law.law_name,
      law.article_no,
      law.article_title,
      law.content,
      law.penalty,
      ...law.topics,
      ...law.queries
    ].join(" ")
  );
}

function precedentSearchText(precedent: PrecedentDocumentRecord): string {
  return normalizeText(
    [
      precedent.case_no,
      precedent.court,
      precedent.summary,
      precedent.verdict,
      precedent.sentence,
      precedent.key_reasoning,
      ...precedent.topics
    ].join(" ")
  );
}

function scoreLaw(plan: KeywordQueryPlan, law: LawDocumentRecord): { score: number; reason: string } {
  const searchable = lawSearchText(law);
  let score = 0.2;
  const reasons: string[] = [];
  const directMatches = includesAny(searchable, [plan.normalizedQuery, ...plan.tokens]);
  const issueMatches = buildIssueLabels(plan.candidateIssues).filter((issue) => law.topics.includes(issue));
  const expandedMatches = includesAny(searchable, plan.lawQueries);

  if (issueMatches.length > 0) {
    score += 0.32;
    reasons.push(`쟁점 ${issueMatches.join(", ")} 와 직접 연결됩니다.`);
  }
  if (directMatches.length > 0) {
    score += 0.22;
    reasons.push(`입력어 ${directMatches.join(", ")} 가 조문 설명과 겹칩니다.`);
  }
  if (expandedMatches.length > 0) {
    score += 0.18;
    reasons.push(`확장 질의 ${expandedMatches.slice(0, 2).join(", ")} 로 근거를 찾았습니다.`);
  }
  if (law.penalty) {
    score += 0.08;
    reasons.push("처벌 조항이 함께 확인됩니다.");
  }

  return {
    score: clampScore(score),
    reason: reasons[0] ?? "입력어와 관련성이 높은 조문으로 분류했습니다."
  };
}

function scorePrecedent(
  plan: KeywordQueryPlan,
  precedent: PrecedentDocumentRecord
): { score: number; reason: string; hasSpecificMatch: boolean } {
  const searchable = precedentSearchText(precedent);
  let score = typeof precedent.similarity_score === "number" ? precedent.similarity_score * 0.4 : 0.18;
  const reasons: string[] = [];
  const directMatches = includesAny(searchable, [plan.normalizedQuery, ...plan.tokens]);
  const issueMatches = buildIssueLabels(plan.candidateIssues).filter((issue) => precedent.topics.includes(issue));
  const expandedMatches = includesAny(searchable, plan.precedentQueries);
  const specificTerms = buildSpecificTerms(plan);
  const specificMatches = includesAny(searchable, specificTerms);

  if (issueMatches.length > 0) {
    score += 0.28;
    reasons.push(`쟁점 ${issueMatches.join(", ")} 와 유사한 사건군입니다.`);
  }
  if (specificMatches.length > 0) {
    score += 0.22;
    reasons.unshift(`입력어와 직접 연결된 표현 ${specificMatches.slice(0, 2).join(", ")} 가 판례 요지에 포함됩니다.`);
  }
  if (directMatches.length > 0) {
    score += 0.18;
    reasons.push(`입력어 ${directMatches.join(", ")} 가 판례 요지와 겹칩니다.`);
  }
  if (expandedMatches.length > 0) {
    score += 0.15;
    reasons.push(`확장 질의 ${expandedMatches.slice(0, 2).join(", ")} 로 찾은 판례입니다.`);
  }
  if (specificTerms.length > 0 && specificMatches.length === 0 && directMatches.length === 0) {
    score -= 0.16;
  }

  return {
    score: clampScore(score),
    reason: reasons[0] ?? "입력어와 유사한 법적 맥락의 판례입니다.",
    hasSpecificMatch: specificMatches.length > 0 || directMatches.length > 0
  };
}

function buildVerifiedCard(
  kind: "law" | "precedent",
  reference: ReferenceLibraryItem,
  score: number,
  reason: string
): VerifiedReferenceCard {
  return {
    id: reference.id,
    kind,
    title: reference.title,
    subtitle: reference.subtitle,
    summary: reference.summary,
    confidenceScore: score,
    matchReason: reason,
    reference
  };
}

export function buildLawVerificationCards(
  plan: KeywordQueryPlan,
  laws: LawDocumentRecord[],
  referencesByKey: Map<string, ReferenceLibraryItem>
): VerifiedReferenceCard[] {
  return laws
    .map((law) => {
      const referenceKey = `law:${law.law_name}:${law.article_no}`;
      const reference = referencesByKey.get(referenceKey);
      if (!reference) {
        return null;
      }
      const { score, reason } = scoreLaw(plan, law);
      return buildVerifiedCard("law", reference, score, reason);
    })
    .filter((card): card is VerifiedReferenceCard => Boolean(card))
    .sort((left, right) => right.confidenceScore - left.confidenceScore);
}

export function buildPrecedentVerificationCards(
  plan: KeywordQueryPlan,
  precedents: PrecedentDocumentRecord[],
  referencesByKey: Map<string, ReferenceLibraryItem>
): VerifiedReferenceCard[] {
  const specificTerms = buildSpecificTerms(plan);
  const cards = precedents
    .map((precedent) => {
      const referenceKey = `precedent:${precedent.case_no}`;
      const reference = referencesByKey.get(referenceKey);
      if (!reference) {
        return null;
      }
      const { score, reason, hasSpecificMatch } = scorePrecedent(plan, precedent);
      return {
        card: buildVerifiedCard("precedent", reference, score, reason),
        hasSpecificMatch
      };
    })
    .filter((entry): entry is { card: VerifiedReferenceCard; hasSpecificMatch: boolean } => Boolean(entry))
    .sort((left, right) => right.card.confidenceScore - left.card.confidenceScore);

  if (specificTerms.length > 0 && cards.some((entry) => entry.hasSpecificMatch)) {
    return cards
      .filter((entry) => entry.hasSpecificMatch)
      .map((entry) => entry.card);
  }

  return cards.map((entry) => entry.card);
}

export function buildVerificationHeadline(plan: KeywordQueryPlan, totalMatches: number): string {
  if (totalMatches === 0) {
    return `입력어 "${plan.originalQuery}" 에 대한 직접 근거를 찾지 못했습니다.`;
  }

  const topIssue = plan.candidateIssues[0];
  if (topIssue) {
    return `입력어 "${plan.originalQuery}" 는 ${topIssue.type} 쟁점으로 우선 검토됩니다.`;
  }

  return `입력어 "${plan.originalQuery}" 와 관련된 근거를 ${totalMatches}건 찾았습니다.`;
}

export function buildVerificationInterpretation(plan: KeywordQueryPlan, totalMatches: number): string {
  if (totalMatches === 0) {
    return "입력어 단독으로는 명확한 법적 평가가 어렵습니다. 전체 문장과 발화 상황을 함께 입력하는 편이 정확합니다.";
  }

  const issueTypes = buildIssueLabels(plan.candidateIssues);
  if (issueTypes.length > 0) {
    return `${issueTypes.join(", ")} 관점에서 조문과 판례를 우선 정리했습니다. 클릭하면 세부 근거를 바로 확인할 수 있습니다.`;
  }

  return "입력어와 관련성이 높은 조문 및 판례를 정리했습니다.";
}
