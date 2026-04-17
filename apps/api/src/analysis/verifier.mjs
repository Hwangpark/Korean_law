function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function hasCitationMap(retrievalEvidencePack) {
  return Array.isArray(retrievalEvidencePack?.citation_map?.citations)
    && retrievalEvidencePack.citation_map.citations.length > 0;
}

function buildConfidenceCalibration(evidenceStrength, scopeAssessment) {
  let score = evidenceStrength === "high" ? 0.84 : evidenceStrength === "medium" ? 0.62 : 0.34;

  if (scopeAssessment?.procedural_heavy) score -= 0.18;
  if (scopeAssessment?.insufficient_facts) score -= 0.14;
  if (scopeAssessment?.unsupported_issue_present) score -= 0.1;

  const normalized = clamp(score);
  return {
    score: Number(normalized.toFixed(2)),
    label: normalized >= 0.75 ? "high" : normalized >= 0.5 ? "medium" : "low"
  };
}

export function buildPreAnalysisVerifier({
  classificationResult,
  retrievalPlan,
  retrievalEvidencePack,
  scopeAssessment,
  evidencePack
}) {
  const selectedReferenceIds = Array.isArray(retrievalEvidencePack?.selected_reference_ids)
    ? retrievalEvidencePack.selected_reference_ids.filter(Boolean)
    : [];
  const citations = Array.isArray(retrievalEvidencePack?.citation_map?.citations)
    ? retrievalEvidencePack.citation_map.citations
    : [];
  const issueTypes = Array.isArray(retrievalPlan?.candidateIssues)
    ? retrievalPlan.candidateIssues.map((issue) => String(issue?.type ?? "").trim()).filter(Boolean)
    : [];
  const evidenceStrength = evidencePack?.evidence_strength ?? retrievalEvidencePack?.evidence_strength ?? "low";
  const citationIntegrity = hasCitationMap(retrievalEvidencePack)
    && citations.every((citation) => citation?.reference_id && citation?.statement_path);
  const contradictionDetected = Boolean(
    scopeAssessment?.unsupported_issue_present
    && Array.isArray(classificationResult?.supported_issues)
    && classificationResult.supported_issues.length === 0
    && issueTypes.length > 0
  );
  const evidenceSufficient = (
    evidenceStrength === "high"
    || (evidenceStrength === "medium" && selectedReferenceIds.length >= 1)
  ) && !Boolean(scopeAssessment?.insufficient_facts);
  const confidenceCalibration = buildConfidenceCalibration(evidenceStrength, scopeAssessment);
  const warnings = [];

  if (!evidenceSufficient) {
    warnings.push("현재 근거만으로는 강한 결론을 내리기 어렵습니다.");
  }
  if (!citationIntegrity) {
    warnings.push("근거 인용 연결이 완전하지 않아 출력 표현을 보수적으로 유지해야 합니다.");
  }
  if (contradictionDetected) {
    warnings.push("지원 범위 밖 이슈와 내부 쟁점 가설 사이에 충돌 가능성이 있습니다.");
  }

  return {
    stage: "pre_analysis_verifier",
    status: warnings.length === 0 ? "passed" : evidenceSufficient && citationIntegrity && !contradictionDetected ? "warning" : "needs_caution",
    evidence_sufficient: evidenceSufficient,
    citation_integrity: citationIntegrity,
    contradiction_detected: contradictionDetected,
    confidence_calibration: confidenceCalibration,
    selected_reference_count: selectedReferenceIds.length,
    issue_count: issueTypes.length,
    warnings: unique(warnings)
  };
}
