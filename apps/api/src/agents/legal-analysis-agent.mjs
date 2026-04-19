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
import { evaluateHighRiskEscalation } from "../analysis/high-risk-policy.mjs";
import { buildPreAnalysisVerifier } from "../analysis/verifier.mjs";
import { buildClaimSupport } from "../analysis/claim-support.mjs";

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

function buildFactSheetLabelMap(facts) {
  return [
    [facts.public_exposure, "제3자가 볼 수 있는 공개 범위가 확인됩니다."],
    [facts.direct_message, "당사자 간 직접 메시지 정황이 있습니다."],
    [facts.repeated_contact, "반복 연락 또는 접근 정황이 보입니다."],
    [facts.threat_signal, "위해를 암시하는 표현 정황이 있습니다."],
    [facts.money_request, "금전 또는 재산 요구 정황이 있습니다."],
    [facts.personal_info_exposed, "개인정보 노출 정황이 있습니다."],
    [facts.insulting_expression, "경멸적 표현 정황이 있습니다."],
    [facts.false_fact_signal, "허위사실 또는 사실 적시 의심 정황이 있습니다."],
    [facts.target_identifiable, "피해자 특정 가능성이 보입니다."]
  ];
}

function buildMissingFactPrompts(issueType, facts) {
  switch (issueType) {
    case "명예훼손":
      return [
        !facts.public_exposure && "제3자가 실제로 볼 수 있었는지, 단체방·커뮤니티 범위를 확인해 주세요.",
        !facts.target_identifiable && "실명, 닉네임, 프로필 등으로 피해자를 특정할 수 있었는지 적어 주세요.",
        !facts.false_fact_signal && "문제가 된 내용이 허위사실인지, 의견 표현인지 구분해 주세요."
      ];
    case "협박/공갈":
      return [
        !facts.threat_signal && "구체적인 해악 고지 표현이 있었는지 원문 그대로 남겨 주세요.",
        !facts.money_request && "금전이나 이익 요구가 있었는지, 있었다면 액수와 맥락을 적어 주세요.",
        !facts.repeated_contact && "같은 취지의 위협이 반복됐는지 시점별로 정리해 주세요."
      ];
    case "모욕":
      return [
        !facts.insulting_expression && "경멸적 표현이 정확히 무엇이었는지 원문 그대로 남겨 주세요.",
        !facts.public_exposure && "다른 사람이 볼 수 있는 자리였는지 확인해 주세요.",
        !facts.target_identifiable && "피해자를 특정할 수 있는 단서가 있었는지 적어 주세요."
      ];
    case "개인정보 유출":
      return [
        !facts.personal_info_exposed && "노출된 개인정보 항목이 무엇인지 구체적으로 적어 주세요.",
        !facts.public_exposure && "해당 정보가 몇 명에게, 어떤 채널로 공개됐는지 확인해 주세요."
      ];
    case "스토킹":
      return [
        !facts.repeated_contact && "연락이나 접근이 반복됐는지 날짜 순서대로 정리해 주세요.",
        !facts.direct_message && !facts.public_exposure && "직접 연락인지, 오프라인 접근인지, 공개 게시인지 유형을 나눠 주세요."
      ];
    case "사기":
      return [
        !facts.money_request && "금전 지급 또는 송금 요구가 있었는지 확인해 주세요.",
        "상대방 설명을 믿고 실제로 돈이나 재산상 처분을 했는지 적어 주세요."
      ];
    default:
      return [];
  }
}

function buildFactSheet(issueCandidates, facts, scopeAssessment) {
  const key_points = unique(
    buildFactSheetLabelMap(facts)
      .filter(([enabled]) => enabled)
      .map(([, label]) => label)
  );

  const missing_points = unique(
    issueCandidates.flatMap((issue) => buildMissingFactPrompts(issue?.type, facts)).filter(Boolean)
  );

  const unsupported_points = unique(
    (scopeAssessment?.unsupported_issues ?? []).map((issue) => `현재 입력에는 지원 범위 밖 이슈(${issue})가 함께 섞여 있을 수 있습니다.`)
  );

  const recommended_focus = unique([
    ...(scopeAssessment?.insufficient_facts ? ["사실관계 보완 전에는 확정적 판단보다 추가 확인 질문을 우선하세요."] : []),
    ...(issueCandidates[0]?.fact_hints?.length
      ? issueCandidates[0].fact_hints.map((hint) => `${hint} 관련 자료를 우선 확인하세요.`)
      : [])
  ]);

  return {
    key_points,
    missing_points,
    unsupported_points,
    recommended_focus
  };
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
    supporting_precedents: charge.supporting_precedents,
    grounding: charge.grounding
  }));
}

function buildSummaryGrounding(charges) {
  const topGrounding = charges[0]?.grounding;
  if (!topGrounding) {
    return null;
  }

  return {
    law_reference_id: topGrounding.law_reference_id ?? null,
    reference_key: topGrounding.reference_key ?? null,
    citation_id: topGrounding.citation_id ?? null,
    precedent_reference_ids: Array.isArray(topGrounding.precedent_reference_ids)
      ? topGrounding.precedent_reference_ids
      : [],
    precedent_citation_ids: Array.isArray(topGrounding.precedent_citation_ids)
      ? topGrounding.precedent_citation_ids
      : [],
    evidence_count: Number(topGrounding.evidence_count ?? 0),
    query_refs: Array.isArray(topGrounding.query_refs) ? topGrounding.query_refs : [],
    match_reason: topGrounding.match_reason ?? "",
    snippet: topGrounding.snippet ?? null
  };
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

function buildDerivedCitationId(citation, statementType, statementPath) {
  return `${citation.citation_id}:${statementType}:${statementPath}`;
}

function addRemappedCitation(citations, seenIds, citation, statementType, statementPath, options = {}) {
  if (!citation) {
    return;
  }

  const useDerivedId = options.useDerivedId === true;
  const nextCitationId = useDerivedId
    ? buildDerivedCitationId(citation, statementType, statementPath)
    : citation.citation_id;
  if (seenIds.has(nextCitationId)) {
    return;
  }

  citations.push({
    ...citation,
    citation_id: nextCitationId,
    statement_type: statementType,
    statement_path: statementPath
  });
  seenIds.add(nextCitationId);
}

function buildAnalysisCitationMap(originalCitationMap, summary, charges, precedentCards, evidencePack) {
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
    const citation = findCitation(lookup, charge?.grounding);
    addRemappedCitation(
      citations,
      seenIds,
      citation,
      "charge",
      `legal_analysis.charges[${index}]`
    );
    addRemappedCitation(
      citations,
      seenIds,
      citation,
      "issue_card",
      `legal_analysis.issue_cards[${index}]`,
      { useDerivedId: true }
    );
  });

  if (summary && charges[0]?.grounding) {
    addRemappedCitation(
      citations,
      seenIds,
      findCitation(lookup, charges[0].grounding),
      "summary",
      "legal_analysis.summary",
      { useDerivedId: true }
    );
  }

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
      `legal_analysis.grounding_evidence.laws[${index}]`,
      { useDerivedId: true }
    );
  });

  (evidencePack.precedents ?? []).forEach((precedent, index) => {
    addRemappedCitation(
      citations,
      seenIds,
      findCitation(lookup, precedent),
      "grounding_evidence",
      `legal_analysis.grounding_evidence.precedents[${index}]`,
      { useDerivedId: true }
    );
  });

  originalCitations.forEach((citation) => {
    addRemappedCitation(
      citations,
      seenIds,
      citation,
      "grounding_evidence",
      "legal_analysis.grounding_evidence",
      { useDerivedId: true }
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
  const requestText = String(options.request?.text ?? options.request?.query ?? "").trim();
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
  const summary = buildSummary(issueCandidates, charges, evidencePack, scopeAssessment, facts);
  const fact_sheet = buildFactSheet(issueCandidates, facts, scopeAssessment);
  const citationMap = buildAnalysisCitationMap(
    options.retrievalEvidencePack?.citation_map,
    summary,
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
    profileContext,
    text: requestText
  });
  const highRiskEscalation = evaluateHighRiskEscalation({
    text: requestText,
    facts,
    issueTypes: issueCandidates.map((issue) => issue.type),
    profileContext,
    scopeAssessment
  });
  const disclaimer = providerMode === "live"
    ? "본 분석은 공식 법령·판례 API를 참고한 안내용 결과이며 법적 효력은 없습니다. 구체적 대응은 변호사 상담이 필요합니다."
    : "본 분석은 mock 데이터 기반 참고용 초안이며 법적 효력은 없습니다. 구체적 대응은 변호사 상담이 필요합니다.";

  const summaryGrounding = buildSummaryGrounding(charges);
  const claim_support = buildClaimSupport({
    summary,
    charges,
    citationMap
  });
  const verifier = options.verifier ?? buildPreAnalysisVerifier({
    classificationResult,
    retrievalPlan,
    retrievalEvidencePack: options.retrievalEvidencePack,
    scopeAssessment,
    evidencePack,
    claimSupport: claim_support
  });

  return {
    mode: providerMode,
    can_sue: judgment.can_sue,
    risk_level: judgment.risk_level,
    charges,
    recommended_actions: judgment.recommended_actions,
    evidence_to_collect: judgment.evidence_to_collect,
    disclaimer,
    summary,
    fact_sheet,
    ...(summaryGrounding ? { summary_grounding: summaryGrounding } : {}),
    issue_cards: buildIssueCards(charges),
    precedent_cards: precedentCards,
    next_steps: judgment.recommended_actions,
    profile_context: profileContext ?? undefined,
    profile_considerations: judgment.profile_considerations,
    facts_snapshot: facts,
    decision_axis: judgment.decision_axis,
    scope_assessment: judgment.scope_assessment,
    claim_support,
    verifier,
    grounding_evidence: evidencePack,
    citation_map: citationMap,
    selected_reference_ids: selectedReferenceIds,
    share_text: `${summary} 우선 원본 증거와 시간 순서를 정리한 뒤, 필요한 경우 전문 상담을 검토하세요.`,
    high_risk_escalation: highRiskEscalation
  };
}
