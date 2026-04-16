import { ISSUE_CATALOG, SEVERITY_TO_RISK } from "../lib/issue-catalog.mjs";
import {
  buildChargeElementChecklist,
  buildChargeProbability,
  buildGroundingEvidence,
  buildGroundingEvidenceFromRetrievalPack,
  buildScopeAssessment
} from "../analysis/evidence.mjs";
import {
  getCanonicalIssueTypes,
  getIssueHypothesisConfidenceMap,
  getNormalizedFacts,
  getNormalizedLegalElements
} from "../analysis/analysis-normalization.mjs";
import { buildJudgmentCore } from "../analysis/judgment-core.mjs";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function getIssueCatalogMap() {
  return new Map(ISSUE_CATALOG.map((issue) => [issue.type, issue]));
}

function getFacts(classificationResult) {
  return getNormalizedFacts(classificationResult);
}

function getIssueHypothesisMap(classificationResult) {
  const hypotheses = Array.isArray(classificationResult?.issue_hypotheses)
    ? classificationResult.issue_hypotheses
    : [];

  return new Map(
    hypotheses
      .map((hypothesis) => [String(hypothesis?.type ?? "").trim(), hypothesis])
      .filter(([type]) => type)
  );
}

function getLegalElementSignals(classificationResult, issueType) {
  const legalElements = getNormalizedLegalElements(classificationResult, issueType);
  return Object.entries(legalElements)
    .filter(([, enabled]) => enabled === true)
    .map(([signal]) => signal);
}

function buildFactHints(issueType, facts) {
  const hints = [];

  switch (issueType) {
    case "명예훼손":
      if (facts.public_exposure) hints.push("공연성");
      if (facts.false_fact_signal) hints.push("허위사실");
      if (facts.target_identifiable) hints.push("특정성");
      break;
    case "협박/공갈":
      if (facts.threat_signal) hints.push("해악 고지");
      if (facts.money_request) hints.push("금전 요구");
      if (facts.repeated_contact) hints.push("반복 협박");
      break;
    case "모욕":
      if (facts.insulting_expression) hints.push("경멸적 표현");
      if (facts.public_exposure) hints.push("공연성");
      if (facts.target_identifiable) hints.push("특정성");
      break;
    case "개인정보 유출":
      if (facts.personal_info_exposed) hints.push("식별 가능한 개인정보");
      if (facts.public_exposure) hints.push("공개");
      break;
    case "스토킹":
      if (facts.repeated_contact) hints.push("반복성");
      if (facts.direct_message || facts.public_exposure) hints.push("접근 또는 연락");
      break;
    case "사기":
      if (facts.money_request) hints.push("재산상 처분행위");
      break;
    default:
      break;
  }

  return unique(hints);
}

function getAnalysisIssueCandidates(classificationResult) {
  const catalogMap = getIssueCatalogMap();
  const issues = Array.isArray(classificationResult?.issues) ? classificationResult.issues : [];
  const issueMap = new Map(
    issues
      .map((issue) => [String(issue?.type ?? "").trim(), issue])
      .filter(([type]) => type)
  );
  const hypothesisConfidenceMap = getIssueHypothesisConfidenceMap(classificationResult);
  const hypothesisMap = getIssueHypothesisMap(classificationResult);
  const facts = getFacts(classificationResult);

  return getCanonicalIssueTypes(classificationResult).map((type) => {
    const issue = issueMap.get(type) ?? {};
    const catalog = catalogMap.get(type);
    const hypothesis = hypothesisMap.get(type) ?? {};
    const hypothesisConfidence = hypothesisConfidenceMap.get(type);
    const legalElementSignals = getLegalElementSignals(classificationResult, type);
    const inferredSeverity = typeof hypothesisConfidence === "number"
      ? (hypothesisConfidence >= 0.75 ? "high" : hypothesisConfidence >= 0.5 ? "medium" : "low")
      : "low";

    return {
      type,
      severity: issue?.severity ?? catalog?.severity ?? inferredSeverity,
      charge_label: issue?.charge_label ?? catalog?.charge_label ?? type,
      matched_terms: unique(
        Array.isArray(hypothesis?.matched_terms)
          ? hypothesis.matched_terms.map((term) => String(term ?? "").trim()).filter(Boolean)
          : Array.isArray(issue?.keywords)
            ? issue.keywords.map((term) => String(term ?? "").trim()).filter(Boolean)
            : []
      ),
      hypothesis_confidence: hypothesisConfidence,
      hypothesis_reason: String(hypothesis?.reason ?? "").trim() || null,
      legal_element_signals: legalElementSignals,
      fact_hints: buildFactHints(type, facts)
    };
  });
}

function getFallbackElements(issueType) {
  switch (issueType) {
    case "명예훼손":
      return ["공연성", "사실 또는 허위사실 적시", "피해자 특정 가능성"];
    case "협박/공갈":
      return ["해악 고지", "상대방 전달 가능성", "금전 또는 이익 요구 여부"];
    case "모욕":
      return ["경멸적 표현", "공개적 전파 가능성", "피해자 특정 가능성"];
    case "개인정보 유출":
      return ["식별 가능한 정보", "공개 또는 전달 행위", "동의 여부"];
    case "스토킹":
      return ["반복성", "접근 또는 연락", "불안감 유발"];
    case "사기":
      return ["기망", "재산상 처분행위", "금전 피해"];
    default:
      return ["사실관계 추가 확인 필요"];
  }
}

function buildSummary(issueCandidates, charges, evidencePack, scopeAssessment, facts) {
  if (scopeAssessment.procedural_heavy) {
    return "현재 입력은 절차법 또는 상고이유 중심 내용이 강해, 실체 쟁점 판단보다 별도 사실관계 정리가 더 중요합니다.";
  }

  if (scopeAssessment.unsupported_issue_present && charges.length === 0) {
    return "현재 입력은 서비스 지원 범위 밖 이슈가 중심이라, 지원 중인 6개 이슈로 바로 정리하기 어렵습니다.";
  }

  if (scopeAssessment.insufficient_facts && charges.length === 0) {
    return "현재 입력만으로는 지원 범위의 법적 쟁점을 충분히 특정하기 어렵습니다.";
  }

  if (charges.length === 0) {
    const topIssue = issueCandidates[0];
    if (topIssue) {
      const issueHint = topIssue.fact_hints?.[0]
        ? ` ${topIssue.fact_hints[0]} 여부를 중심으로 사실관계를 더 보완해 보세요.`
        : "";
      return `${topIssue.type} 가능성은 먼저 보이지만, 현재 단계에서는 지원 범위의 핵심 쟁점을 확정하기 어려워 추가 사실관계가 필요합니다.${issueHint}`;
    }

    return "현재 단계에서는 지원 범위의 핵심 쟁점을 확정하기 어려워 추가 사실관계가 필요합니다.";
  }

  const topIssue = issueCandidates[0] ?? null;
  const topCharge = charges[0];
  const strengthLabel = evidencePack.evidence_strength === "high"
    ? "근거가 비교적 탄탄한 편"
    : evidencePack.evidence_strength === "medium"
      ? "관련 근거가 일부 확보된 편"
      : "근거가 아직 약한 편";
  const factSuffix = facts.public_exposure
    ? " 공개 범위와 전파 가능성이 핵심 사실관계입니다."
    : facts.repeated_contact
      ? " 반복 접촉 여부가 핵심 사실관계입니다."
      : facts.money_request
        ? " 금전 요구와 거래 정황이 핵심 사실관계입니다."
        : "";
  const issueLead = topIssue
    ? `${topIssue.type} 가능성이 우선 보이며`
    : `${topCharge.charge} 중심 이슈가 우선 보이며`;
  const issueHint = topIssue?.fact_hints?.[0]
    ? ` ${topIssue.fact_hints[0]} 여부가 핵심 판단 포인트입니다.`
    : factSuffix;
  const chargeLead = topCharge.charge !== topIssue?.type
    ? ` 현재 정리는 ${topCharge.charge} 중심으로 이어집니다.`
    : "";

  return `${issueLead} 현재 확보된 법령·판례 근거는 ${strengthLabel}입니다.${chargeLead}${issueHint}`;
}

function buildIssueCards(charges) {
  return charges.map((charge) => ({
    title: charge.charge,
    basis: charge.basis,
    probability: charge.probability,
    expected_penalty: charge.expected_penalty,
    checklist: charge.elements_met,
    supporting_precedents: charge.supporting_precedents
  }));
}

function buildPrecedentGrounding(precedent) {
  return {
    reference_id: precedent.reference_id ?? precedent.reference_key ?? null,
    reference_key: precedent.reference_key ?? null,
    citation_id: precedent.citation_id ?? null,
    query_refs: Array.isArray(precedent.query_refs) ? precedent.query_refs : [],
    match_reason: precedent.match_reason ?? "",
    snippet: precedent.snippet
      ? {
          field: precedent.source_field ?? "summary",
          text: precedent.snippet
        }
      : null,
    evidence_count: 1
  };
}

function buildPrecedentCards(evidencePack) {
  return (evidencePack.precedents ?? []).map((precedent) => ({
    case_no: precedent.case_no,
    court: precedent.court,
    verdict: precedent.verdict,
    summary: precedent.snippet,
    similarity_score: precedent.confidence_score,
    match_reason: precedent.match_reason,
    grounding: buildPrecedentGrounding(precedent)
  }));
}

function indexCitations(citations, key) {
  return citations.reduce((accumulator, citation) => {
    const value = citation?.[key];
    if (!value) {
      return accumulator;
    }
    if (!accumulator[value]) {
      accumulator[value] = [];
    }
    accumulator[value].push(citation.citation_id);
    return accumulator;
  }, {});
}

function rebuildCitationMap(citations) {
  return {
    version: "v2",
    citations,
    by_reference_id: indexCitations(citations, "reference_id"),
    by_statement_path: indexCitations(citations, "statement_path")
  };
}

function buildCitationLookup(citationMap) {
  const lookup = new Map();
  const citations = Array.isArray(citationMap?.citations) ? citationMap.citations : [];

  citations.forEach((citation) => {
    [citation.citation_id, citation.reference_id, citation.reference_key]
      .filter(Boolean)
      .forEach((key) => lookup.set(key, citation));
  });

  return lookup;
}

function findCitation(lookup, grounding) {
  if (!grounding) {
    return null;
  }

  const keys = [
    grounding.citation_id,
    grounding.law_reference_id,
    grounding.reference_id,
    grounding.reference_key
  ].filter(Boolean);

  for (const key of keys) {
    const citation = lookup.get(key);
    if (citation) {
      return citation;
    }
  }

  return null;
}

function addRemappedCitation(citations, seenIds, citation, statementType, statementPath) {
  if (!citation || seenIds.has(citation.citation_id)) {
    return;
  }

  citations.push({
    ...citation,
    statement_type: statementType,
    statement_path: statementPath
  });
  seenIds.add(citation.citation_id);
}

function buildAnalysisCitationMap(originalCitationMap, charges, precedentCards, evidencePack) {
  const originalCitations = Array.isArray(originalCitationMap?.citations)
    ? originalCitationMap.citations
    : [];
  if (originalCitations.length === 0) {
    return undefined;
  }

  const lookup = buildCitationLookup(originalCitationMap);
  const citations = [];
  const seenIds = new Set();

  charges.forEach((charge, index) => {
    addRemappedCitation(
      citations,
      seenIds,
      findCitation(lookup, charge?.grounding),
      "charge",
      `legal_analysis.charges[${index}]`
    );
  });

  precedentCards.forEach((card, index) => {
    addRemappedCitation(
      citations,
      seenIds,
      findCitation(lookup, card?.grounding),
      "precedent_card",
      `legal_analysis.precedent_cards[${index}]`
    );
  });

  (evidencePack.laws ?? []).forEach((law, index) => {
    addRemappedCitation(
      citations,
      seenIds,
      findCitation(lookup, law),
      "grounding_evidence",
      `legal_analysis.grounding_evidence.laws[${index}]`
    );
  });

  (evidencePack.precedents ?? []).forEach((precedent, index) => {
    addRemappedCitation(
      citations,
      seenIds,
      findCitation(lookup, precedent),
      "grounding_evidence",
      `legal_analysis.grounding_evidence.precedents[${index}]`
    );
  });

  originalCitations.forEach((citation) => {
    addRemappedCitation(
      citations,
      seenIds,
      citation,
      "grounding_evidence",
      "legal_analysis.grounding_evidence"
    );
  });

  return rebuildCitationMap(citations);
}

function getIssueMatchedEntries(entries, issueType, issueCount) {
  const exactMatches = (entries ?? []).filter((entry) =>
    Array.isArray(entry.matched_issue_types) && entry.matched_issue_types.includes(issueType)
  );
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  if (issueCount === 1) {
    return (entries ?? []).filter((entry) =>
      !Array.isArray(entry.matched_issue_types) || entry.matched_issue_types.length === 0
    );
  }

  return [];
}

function buildChargeGrounding(relatedLaw, relatedPrecedents) {
  return {
    law_reference_id: relatedLaw?.reference_id ?? relatedLaw?.reference_key ?? null,
    reference_key: relatedLaw?.reference_key ?? null,
    citation_id: relatedLaw?.citation_id ?? null,
    query_refs: Array.isArray(relatedLaw?.query_refs) ? relatedLaw.query_refs : [],
    match_reason: relatedLaw?.match_reason ?? "",
    snippet: relatedLaw?.snippet
      ? {
          field: relatedLaw.source_field ?? "content",
          text: relatedLaw.snippet
        }
      : null,
    precedent_reference_ids: relatedPrecedents
      .map((precedent) => precedent.reference_id ?? precedent.reference_key)
      .filter(Boolean),
    precedent_citation_ids: relatedPrecedents
      .map((precedent) => precedent.citation_id)
      .filter(Boolean),
    evidence_count: Number(Boolean(relatedLaw)) + relatedPrecedents.length
  };
}

function buildCharges(classificationResult, retrievalPlan, evidencePack, scopeAssessment) {
  const catalogMap = getIssueCatalogMap();
  const issues = getAnalysisIssueCandidates(classificationResult);
  const issueCount = issues.length;

  return issues
    .map((issue) => {
      const type = String(issue?.type ?? "").trim();
      if (!type) {
        return null;
      }

      const catalog = catalogMap.get(type);
      const relatedLaws = getIssueMatchedEntries(evidencePack.laws, type, issueCount);
      const relatedLaw = relatedLaws[0] ?? null;
      const relatedPrecedents = getIssueMatchedEntries(evidencePack.precedents, type, issueCount);
      const basis = relatedLaw
        ? [relatedLaw.law_name, relatedLaw.article_no].filter(Boolean).join(" ")
        : "관련 조문 추가 확인 필요";
      const expectedPenalty = relatedLaw?.penalty || "관련 조문 추가 확인 필요";
      const fallbackElements = getFallbackElements(type);

      const probability = buildChargeProbability(
        {
          type,
          severity: catalog?.severity ?? issue?.severity ?? "low"
        },
        classificationResult,
        evidencePack,
        scopeAssessment
      );

      return {
        issue_type: type,
        charge: String(issue?.charge_label ?? catalog?.charge_label ?? type),
        basis,
        elements_met: buildChargeElementChecklist(classificationResult, type, fallbackElements),
        probability,
        expected_penalty: expectedPenalty,
        supporting_precedents: relatedPrecedents.map((precedent) => precedent.case_no).filter(Boolean),
        grounding: buildChargeGrounding(relatedLaw, relatedPrecedents),
        hypothesis_confidence: issue?.hypothesis_confidence ?? null,
        hypothesis_reason: issue?.hypothesis_reason ?? null,
        fact_hints: Array.isArray(issue?.fact_hints) ? issue.fact_hints : []
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftPriority = left.probability === "high" ? 3 : left.probability === "medium" ? 2 : 1;
      const rightPriority = right.probability === "high" ? 3 : right.probability === "medium" ? 2 : 1;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }
      const rightHypothesis = Number(right.hypothesis_confidence ?? 0);
      const leftHypothesis = Number(left.hypothesis_confidence ?? 0);
      if (rightHypothesis !== leftHypothesis) {
        return rightHypothesis - leftHypothesis;
      }
      return Number(right.grounding?.evidence_count ?? 0) - Number(left.grounding?.evidence_count ?? 0);
    });
}

export async function runLegalAnalysisAgent(
  classificationResult,
  lawSearchResult,
  precedentSearchResult,
  options = {}
) {
  const providerMode = options.providerMode ?? "mock";
  const profileContext = options.profileContext ?? options.userContext ?? null;
  const retrievalPlan = options.retrievalPlan ?? null;
  const facts = getFacts(classificationResult);
  const issueCandidates = getAnalysisIssueCandidates(classificationResult);

  const scopeAssessment = buildScopeAssessment(classificationResult, retrievalPlan);
  const evidencePack = options.retrievalEvidencePack
    ? buildGroundingEvidenceFromRetrievalPack(options.retrievalEvidencePack)
    : buildGroundingEvidence(
      classificationResult,
      retrievalPlan,
      lawSearchResult,
      precedentSearchResult
    );
  const charges = buildCharges(classificationResult, retrievalPlan, evidencePack, scopeAssessment);
  const precedentCards = buildPrecedentCards(evidencePack);
  const citationMap = buildAnalysisCitationMap(
    options.retrievalEvidencePack?.citation_map,
    charges,
    precedentCards,
    evidencePack
  );
  const selectedReferenceIds = Array.isArray(options.retrievalEvidencePack?.selected_reference_ids)
    ? unique(options.retrievalEvidencePack.selected_reference_ids)
    : unique([
      ...(evidencePack.laws ?? []).map((law) => law.reference_key),
      ...(evidencePack.precedents ?? []).map((precedent) => precedent.reference_key)
    ]);
  const issueRiskScores = issueCandidates.map((issue) => SEVERITY_TO_RISK[issue?.severity] ?? 1);
  const judgment = buildJudgmentCore({
    facts,
    charges,
    scopeAssessment,
    groundingEvidence: evidencePack,
    issueCandidates,
    baseRiskLevel: Math.max(1, ...issueRiskScores, 1),
    profileContext
  });
  const disclaimer = providerMode === "live"
    ? "본 분석은 공식 법령·판례 API를 참고한 안내용 결과이며 법적 효력은 없습니다. 구체적 대응은 변호사 상담이 필요합니다."
    : "본 분석은 mock 데이터 기반 참고용 초안이며 법적 효력은 없습니다. 구체적 대응은 변호사 상담이 필요합니다.";
  const summary = buildSummary(issueCandidates, charges, evidencePack, scopeAssessment, facts);

  return {
    mode: providerMode,
    can_sue: judgment.can_sue,
    risk_level: judgment.risk_level,
    charges,
    recommended_actions: judgment.recommended_actions,
    evidence_to_collect: judgment.evidence_to_collect,
    disclaimer,
    summary,
    issue_cards: buildIssueCards(charges),
    precedent_cards: precedentCards,
    next_steps: judgment.recommended_actions,
    profile_context: profileContext ?? undefined,
    profile_considerations: judgment.profile_considerations,
    facts_snapshot: facts,
    decision_axis: judgment.decision_axis,
    scope_assessment: judgment.scope_assessment,
    grounding_evidence: evidencePack,
    citation_map: citationMap,
    selected_reference_ids: selectedReferenceIds,
    share_text: `${summary} 우선 원본 증거와 시간 순서를 정리한 뒤, 필요한 경우 전문 상담을 검토하세요.`
  };
}
