import {
  buildEvidenceStrengthFromScores,
  clampEvidenceScore,
  includesEvidenceQueries,
  limitEvidenceText,
  normalizeEvidenceText,
  uniqueEvidenceValues
} from "./evidence-shared.mjs";
import {
  getCanonicalIssueTypes,
  getNormalizedFacts,
  getIssueHypothesisConfidenceMap,
  getNormalizedIssueTypes,
  getNormalizedLegalElements,
  resolveAnalysisScopeSnapshot
} from "./analysis-normalization.mjs";
import {
  buildLawReferenceKey,
  buildPrecedentReferenceKey
} from "./reference-keys.mjs";
import { buildJudgmentCore } from "./judgment-core.mjs";

function normalizeText(value) {
  return normalizeEvidenceText(value);
}

function unique(values) {
  return uniqueEvidenceValues(values);
}

function clampConfidenceScore(value) {
  return clampEvidenceScore(value);
}

function limitText(value, maxLength = 220) {
  return limitEvidenceText(value, maxLength);
}

function includesAny(text, queries) {
  return includesEvidenceQueries(text, queries);
}

function getIssueTypes(classificationResult) {
  return getNormalizedIssueTypes(classificationResult);
}

function getCanonicalIssues(classificationResult) {
  return getCanonicalIssueTypes(classificationResult);
}

function getIssueHypothesisMap(classificationResult) {
  return getIssueHypothesisConfidenceMap(classificationResult);
}

function getLegalElements(classificationResult, issueType) {
  return getNormalizedLegalElements(classificationResult, issueType);
}

function getFacts(classificationResult) {
  return getNormalizedFacts(classificationResult);
}

function getFactDrivenElementHints(issueType, facts) {
  const hints = [];

  switch (issueType) {
    case "명예훼손":
      if (facts.false_fact_signal) hints.push("허위/거짓 사실 언급 신호 있음");
      if (facts.public_exposure) hints.push("공개 전파 신호 있음");
      if (facts.target_identifiable) hints.push("대상 특정 신호 있음");
      break;
    case "모욕":
      if (facts.insulting_expression) hints.push("경멸적 표현 신호 있음");
      if (facts.public_exposure) hints.push("공개 전파 신호 있음");
      if (facts.target_identifiable) hints.push("대상 특정 신호 있음");
      break;
    case "협박/공갈":
      if (facts.threat_signal) hints.push("해악 고지 신호 있음");
      if (facts.money_request) hints.push("금전 요구 신호 있음");
      if (facts.repeated_contact) hints.push("반복 압박 신호 있음");
      break;
    case "개인정보 유출":
      if (facts.personal_info_exposed) hints.push("식별 가능한 개인정보 노출 신호 있음");
      if (facts.public_exposure) hints.push("공개 전파 신호 있음");
      break;
    case "스토킹":
      if (facts.repeated_contact) hints.push("반복 접촉 신호 있음");
      if (facts.direct_message) hints.push("직접 연락/메신저 접촉 신호 있음");
      if (facts.threat_signal) hints.push("불안감 조성 가능 신호 있음");
      break;
    case "사기":
      if (facts.money_request) hints.push("금전 요구 또는 송금 유도 신호 있음");
      if (facts.direct_message) hints.push("직접 거래 문맥 신호 있음");
      break;
    default:
      break;
  }

  return hints;
}

function getFactsProbabilityAdjustment(issueType, facts) {
  let score = 0;

  switch (issueType) {
    case "명예훼손":
      if (facts.false_fact_signal) score += 0.12;
      if (facts.public_exposure) score += 0.08;
      if (facts.target_identifiable) score += 0.07;
      break;
    case "모욕":
      if (facts.insulting_expression) score += 0.14;
      if (facts.public_exposure) score += 0.06;
      if (facts.target_identifiable) score += 0.04;
      break;
    case "협박/공갈":
      if (facts.threat_signal) score += 0.16;
      if (facts.money_request) score += 0.08;
      if (facts.repeated_contact) score += 0.04;
      break;
    case "개인정보 유출":
      if (facts.personal_info_exposed) score += 0.18;
      if (facts.public_exposure) score += 0.05;
      break;
    case "스토킹":
      if (facts.repeated_contact) score += 0.15;
      if (facts.direct_message) score += 0.08;
      if (facts.threat_signal) score += 0.04;
      break;
    case "사기":
      if (facts.money_request) score += 0.14;
      if (facts.direct_message) score += 0.06;
      if (facts.repeated_contact) score += 0.03;
      break;
    default:
      break;
  }

  return score;
}

function scoreLawEvidence(plan, law) {
  const searchable = normalizeText([
    law.law_name,
    law.article_no,
    law.article_title,
    law.content,
    law.penalty,
    ...(law.topics ?? []),
    ...(law.queries ?? [])
  ].join(" "));

  const preciseMatches = includesAny(searchable, plan?.preciseLawQueries ?? []);
  const broadMatches = includesAny(searchable, plan?.broadLawQueries ?? []);
  const topicMatches = unique((law.topics ?? []).filter((topic) =>
    (plan?.candidateIssues ?? []).some((issue) => issue.type === topic)
  ));

  let score = 0.2;
  let reason = "검색된 법령 중 입력과 가장 가까운 조문입니다.";

  if (preciseMatches.length > 0) {
    score += 0.45;
    reason = `구체 질의 ${preciseMatches.slice(0, 2).join(", ")} 와 직접 겹치는 조문입니다.`;
  } else if (topicMatches.length > 0) {
    score += 0.32;
    reason = `${topicMatches.join(", ")} 쟁점과 직접 연결되는 조문입니다.`;
  } else if (broadMatches.length > 0) {
    score += 0.18;
    reason = `확장 질의 ${broadMatches.slice(0, 2).join(", ")} 기준으로 연결된 조문입니다.`;
  }

  if (law.penalty) {
    score += 0.05;
  }

  return {
    confidence_score: clampConfidenceScore(score),
    match_reason: reason,
    matched_issue_types: topicMatches,
    matched_queries: preciseMatches.length > 0 ? preciseMatches : broadMatches,
    snippet: limitText(law.content || law.article_title || law.penalty)
  };
}

function getCourtAuthorityBoost(court) {
  const normalizedCourt = normalizeText(court ?? "");

  if (!normalizedCourt) {
    return 0;
  }
  if (normalizedCourt.includes("대법원") || normalizedCourt.includes("헌법재판소")) {
    return 0.08;
  }
  if (normalizedCourt.includes("고등법원") || normalizedCourt.includes("특허법원")) {
    return 0.04;
  }
  if (
    normalizedCourt.includes("지방법원")
    || normalizedCourt.includes("가정법원")
    || normalizedCourt.includes("행정법원")
    || normalizedCourt.includes("회생법원")
  ) {
    return 0.015;
  }

  return 0;
}

function scorePrecedentEvidence(plan, precedent) {
  const searchable = normalizeText([
    precedent.case_no,
    precedent.court,
    precedent.summary,
    precedent.verdict,
    precedent.sentence,
    precedent.key_reasoning,
    ...(precedent.topics ?? [])
  ].join(" "));

  const preciseMatches = includesAny(searchable, plan?.precisePrecedentQueries ?? []);
  const broadMatches = includesAny(searchable, plan?.broadPrecedentQueries ?? []);
  const topicMatches = unique((precedent.topics ?? []).filter((topic) =>
    (plan?.candidateIssues ?? []).some((issue) => issue.type === topic)
  ));

  let score = typeof precedent.similarity_score === "number" ? precedent.similarity_score * 0.45 : 0.18;
  let reason = "검색된 판례 중 입력과 가장 가까운 판례입니다.";

  if (preciseMatches.length > 0) {
    score += 0.34;
    reason = `구체 질의 ${preciseMatches.slice(0, 2).join(", ")} 와 겹치는 판례입니다.`;
  } else if (topicMatches.length > 0) {
    score += 0.24;
    reason = `${topicMatches.join(", ")} 쟁점과 유사한 판례입니다.`;
  } else if (broadMatches.length > 0) {
    score += 0.12;
    reason = `확장 질의 ${broadMatches.slice(0, 2).join(", ")} 기준으로 연결된 판례입니다.`;
  }

  score += getCourtAuthorityBoost(precedent.court);

  return {
    confidence_score: clampConfidenceScore(score),
    match_reason: reason,
    matched_issue_types: topicMatches,
    matched_queries: preciseMatches.length > 0 ? preciseMatches : broadMatches,
    snippet: limitText(precedent.key_reasoning || precedent.summary || precedent.sentence)
  };
}

function buildGroundingLawEntry(entry) {
  return {
    reference_key: entry.reference_key,
    law_name: entry.law_name,
    article_no: entry.article_no,
    article_title: entry.article_title,
    penalty: entry.penalty,
    url: entry.url,
    confidence_score: Number(entry.confidence_score ?? 0),
    match_reason: entry.match_reason ?? "",
    matched_issue_types: Array.isArray(entry.matched_issue_types) ? entry.matched_issue_types : [],
    matched_queries: Array.isArray(entry.matched_queries) ? entry.matched_queries.filter(Boolean) : [],
    snippet: String(entry.snippet ?? "").trim()
  };
}

function buildGroundingPrecedentEntry(entry) {
  return {
    reference_key: entry.reference_key,
    case_no: entry.case_no,
    court: entry.court,
    verdict: entry.verdict,
    sentence: entry.sentence,
    url: entry.url,
    confidence_score: Number(entry.confidence_score ?? 0),
    match_reason: entry.match_reason ?? "",
    matched_issue_types: Array.isArray(entry.matched_issue_types) ? entry.matched_issue_types : [],
    matched_queries: Array.isArray(entry.matched_queries) ? entry.matched_queries.filter(Boolean) : [],
    snippet: String(entry.snippet ?? "").trim()
  };
}

function buildGroundingEvidencePayload(topIssue, laws, precedents) {
  return {
    top_issue: topIssue,
    evidence_strength: buildEvidenceStrengthFromScores(
      laws[0]?.confidence_score ?? 0,
      precedents[0]?.confidence_score ?? 0
    ),
    laws,
    precedents
  };
}

export function buildScopeAssessment(classificationResult, retrievalPlan) {
  const scopeSnapshot = resolveAnalysisScopeSnapshot(classificationResult, retrievalPlan);

  return {
    supported_issues: scopeSnapshot.supportedIssues,
    unsupported_issues: scopeSnapshot.unsupportedIssues,
    procedural_heavy: Boolean(scopeSnapshot.scopeFlags.proceduralHeavy),
    insufficient_facts: Boolean(scopeSnapshot.scopeFlags.insufficientFacts),
    unsupported_issue_present: Boolean(scopeSnapshot.scopeFlags.unsupportedIssuePresent),
    warnings: scopeSnapshot.scopeWarnings
  };
}

export function buildGroundingEvidence(
  classificationResult,
  retrievalPlan,
  lawSearchResult,
  precedentSearchResult
) {
  const laws = (lawSearchResult?.laws ?? [])
    .map((law) => buildGroundingLawEntry({
      reference_key: buildLawReferenceKey(law.law_name, law.article_no),
      law_name: law.law_name,
      article_no: law.article_no,
      article_title: law.article_title,
      penalty: law.penalty,
      url: law.url,
      ...scoreLawEvidence(retrievalPlan, law)
    }))
    .sort((left, right) => right.confidence_score - left.confidence_score)
    .slice(0, 3);

  const precedents = (precedentSearchResult?.precedents ?? [])
    .map((precedent) => buildGroundingPrecedentEntry({
      reference_key: buildPrecedentReferenceKey(precedent.case_no),
      case_no: precedent.case_no,
      court: precedent.court,
      verdict: precedent.verdict,
      sentence: precedent.sentence,
      url: precedent.url,
      ...scorePrecedentEvidence(retrievalPlan, precedent)
    }))
    .sort((left, right) => right.confidence_score - left.confidence_score)
    .slice(0, 3);

  const topIssue = retrievalPlan?.candidateIssues?.[0]?.type ?? getCanonicalIssues(classificationResult)[0] ?? null;
  return buildGroundingEvidencePayload(topIssue, laws, precedents);
}

export function buildGroundingEvidenceFromRetrievalPack(retrievalEvidencePack) {
  const matchedLaws = Array.isArray(retrievalEvidencePack?.matched_laws)
    ? retrievalEvidencePack.matched_laws
    : [];
  const matchedPrecedents = Array.isArray(retrievalEvidencePack?.matched_precedents)
    ? retrievalEvidencePack.matched_precedents
    : [];
  const citations = Array.isArray(retrievalEvidencePack?.citation_map?.citations)
    ? retrievalEvidencePack.citation_map.citations
    : [];
  const citationsByReference = new Map();
  citations.forEach((citation) => {
    [citation.reference_id, citation.reference_key].filter(Boolean).forEach((key) => {
      citationsByReference.set(key, citation);
    });
  });

  const laws = matchedLaws.map((item) => buildGroundingLawEntry({
    reference_key: item.referenceKey ?? item.id,
    law_name: item.source?.law_name ?? item.reference?.title ?? item.title,
    article_no: item.source?.article_no ?? item.reference?.articleNo ?? "",
    article_title: item.source?.article_title ?? item.reference?.subtitle ?? item.subtitle,
    penalty: item.source?.penalty ?? item.reference?.penalty ?? "",
    url: item.source?.url ?? item.reference?.url ?? "",
    confidence_score: Number(item.confidenceScore ?? 0),
    match_reason: item.matchReason ?? "",
    matched_issue_types: Array.isArray(item.matchedIssueTypes) ? item.matchedIssueTypes : [],
    matched_queries: Array.isArray(item.matchedQueries)
      ? item.matchedQueries.map((query) => String(query?.text ?? "").trim()).filter(Boolean)
      : [],
    snippet: String(item.snippet?.text ?? item.summary ?? "").trim()
  })).map((entry) => {
    const citation = citationsByReference.get(entry.reference_key);
    return {
      ...entry,
      ...(citation
        ? {
            citation_id: citation.citation_id,
            reference_id: citation.reference_id,
            reference_key: citation.reference_key,
            query_refs: Array.isArray(citation.query_refs) ? citation.query_refs : [],
            source_field: citation.snippet?.field ?? ""
          }
        : {})
    };
  });
  const precedents = matchedPrecedents.map((item) => buildGroundingPrecedentEntry({
    reference_key: item.referenceKey ?? item.id,
    case_no: item.source?.case_no ?? item.reference?.caseNo ?? item.title,
    court: item.source?.court ?? item.reference?.court ?? "",
    verdict: item.source?.verdict ?? item.reference?.verdict ?? "",
    sentence: item.source?.sentence ?? item.reference?.penalty ?? "",
    url: item.source?.url ?? item.reference?.url ?? "",
    confidence_score: Number(item.confidenceScore ?? 0),
    match_reason: item.matchReason ?? "",
    matched_issue_types: Array.isArray(item.matchedIssueTypes) ? item.matchedIssueTypes : [],
    matched_queries: Array.isArray(item.matchedQueries)
      ? item.matchedQueries.map((query) => String(query?.text ?? "").trim()).filter(Boolean)
      : [],
    snippet: String(item.snippet?.text ?? item.summary ?? "").trim()
  })).map((entry) => {
    const citation = citationsByReference.get(entry.reference_key);
    return {
      ...entry,
      ...(citation
        ? {
            citation_id: citation.citation_id,
            reference_id: citation.reference_id,
            reference_key: citation.reference_key,
            query_refs: Array.isArray(citation.query_refs) ? citation.query_refs : [],
            source_field: citation.snippet?.field ?? ""
          }
        : {})
    };
  });

  return {
    ...buildGroundingEvidencePayload(
      Array.isArray(retrievalEvidencePack?.top_issue_types)
        ? retrievalEvidencePack.top_issue_types[0] ?? null
        : null,
      laws,
      precedents
    ),
    evidence_strength: retrievalEvidencePack?.evidence_strength ?? buildEvidenceStrengthFromScores(
      laws[0]?.confidence_score ?? 0,
      precedents[0]?.confidence_score ?? 0
    )
  };
}

export function buildChargeElementChecklist(classificationResult, issueType, fallbackElements) {
  const elementMap = getLegalElements(classificationResult, issueType);
  const facts = getFacts(classificationResult);
  const explicitElements = Object.entries(elementMap).map(([key, value]) => {
    const label = key.replace(/_/g, " ");
    return typeof value === "boolean"
      ? `${label}: ${value ? "충족 신호 있음" : "불명확"}`
      : `${label}: ${String(value)}`;
  });
  const factHints = getFactDrivenElementHints(issueType, facts);

  return unique(
    explicitElements.length > 0
      ? [...explicitElements, ...factHints]
      : [...factHints, ...fallbackElements]
  );
}

export function buildChargeProbability(issue, classificationResult, evidencePack, scopeAssessment) {
  const hypothesisConfidence = getIssueHypothesisMap(classificationResult).get(issue.type);
  const facts = getFacts(classificationResult);
  let score = typeof hypothesisConfidence === "number"
    ? hypothesisConfidence
    : issue.severity === "high"
      ? 0.68
      : issue.severity === "medium"
        ? 0.52
        : 0.36;

  const relatedLaw = (evidencePack.laws ?? []).find((law) => law.matched_issue_types.includes(issue.type));
  const relatedPrecedent = (evidencePack.precedents ?? []).find((precedent) =>
    precedent.matched_issue_types.includes(issue.type)
  );

  if (relatedLaw) {
    score += 0.1;
  }
  if (relatedPrecedent) {
    score += 0.08;
  }
  score += getFactsProbabilityAdjustment(issue.type, facts);
  if (scopeAssessment.procedural_heavy) {
    score -= 0.18;
  }
  if (scopeAssessment.insufficient_facts) {
    score -= 0.1;
  }

  if (score >= 0.78) {
    return "high";
  }
  if (score >= 0.5) {
    return "medium";
  }
  return "low";
}

export function buildJudgmentAxis({
  facts,
  charges = [],
  scopeAssessment,
  groundingEvidence,
  baseRiskLevel = 1
}) {
  const judgment = buildJudgmentCore({
    facts,
    charges,
    scopeAssessment,
    groundingEvidence,
    baseRiskLevel
  });

  return {
    can_sue: judgment.can_sue,
    risk_level: judgment.risk_level,
    decision_axis: judgment.decision_axis
  };
}
