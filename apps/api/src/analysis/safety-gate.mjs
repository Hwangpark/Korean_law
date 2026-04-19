function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

export function applyPreOutputSafetyGate(legalAnalysis, { verifier, scopeAssessment } = {}) {
  const warnings = [];
  const blockedReasons = [];
  const safeAnalysis = {
    ...(legalAnalysis ?? {})
  };

  const lowConfidence = verifier?.confidence_calibration?.label === "low";
  const needsCaution = verifier?.status === "needs_caution";
  const highRisk = Number(safeAnalysis?.risk_level ?? 0) >= 4;
  const highRiskEscalation = safeAnalysis?.high_risk_escalation ?? null;

  if (scopeAssessment?.unsupported_issue_present) {
    warnings.push("지원 범위 밖 이슈가 포함될 수 있어 단정적 해석을 피했습니다.");
    blockedReasons.push("unsupported_issue_present");
  }
  if (scopeAssessment?.procedural_heavy) {
    warnings.push("절차 중심 입력이라 실체 판단 표현을 보수적으로 조정했습니다.");
    blockedReasons.push("procedural_heavy");
  }
  if (scopeAssessment?.insufficient_facts || !verifier?.evidence_sufficient) {
    warnings.push("사실관계 또는 근거가 부족해 참고 수준 표현으로 제한했습니다.");
    blockedReasons.push("insufficient_grounding");
  }
  if (!verifier?.citation_integrity) {
    warnings.push("인용 연결이 완전하지 않아 요약 표현을 보수적으로 유지했습니다.");
    blockedReasons.push("citation_integrity");
  }

  if (needsCaution || lowConfidence || blockedReasons.length > 0) {
    safeAnalysis.can_sue = false;
  }

  if ((needsCaution || lowConfidence) && typeof safeAnalysis.summary === "string" && safeAnalysis.summary.trim()) {
    safeAnalysis.summary = `현재 확보된 근거 기준 참고용 판단입니다. ${safeAnalysis.summary}`;
  }
  if (highRiskEscalation?.triggered && typeof safeAnalysis.summary === "string" && safeAnalysis.summary.trim()) {
    safeAnalysis.summary = `긴급성 있는 고위험 신호가 있어 일반 참고보다 안전 확보와 증거 보존을 우선해야 합니다. ${safeAnalysis.summary}`;
    warnings.push(...(Array.isArray(highRiskEscalation.warnings) ? highRiskEscalation.warnings : []));
    blockedReasons.push(...(Array.isArray(highRiskEscalation.triggers) ? highRiskEscalation.triggers : []));
  }

  const recommendedActions = Array.isArray(safeAnalysis.recommended_actions)
    ? safeAnalysis.recommended_actions.filter(Boolean)
    : [];
  if (highRiskEscalation?.triggered) {
    recommendedActions.unshift(...(Array.isArray(highRiskEscalation.immediate_actions) ? highRiskEscalation.immediate_actions : []));
    safeAnalysis.evidence_to_collect = unique([
      ...(Array.isArray(safeAnalysis.evidence_to_collect) ? safeAnalysis.evidence_to_collect : []),
      ...(Array.isArray(highRiskEscalation.evidence_actions) ? highRiskEscalation.evidence_actions : [])
    ]);
  }
  if ((highRisk || highRiskEscalation?.emergency) && !recommendedActions.some((item) => String(item).includes("변호사 상담"))) {
    recommendedActions.push("고위험 사안일 수 있어 원본 증거를 보존한 뒤 변호사 상담 필요성을 빠르게 검토하세요.");
    warnings.push("고위험 상황 상담 권고를 보강했습니다.");
  }
  if (highRiskEscalation?.emergency && !recommendedActions.some((item) => String(item).includes("112"))) {
    recommendedActions.unshift("지금 신체 안전 위험이나 지속적 접근이 의심되면 즉시 112 신고를 우선 검토하세요.");
    warnings.push("긴급 신고 우선 안내를 보강했습니다.");
  }
  safeAnalysis.recommended_actions = unique(recommendedActions);
  safeAnalysis.next_steps = unique(Array.isArray(safeAnalysis.next_steps) ? safeAnalysis.next_steps : safeAnalysis.recommended_actions);

  const safetyGate = {
    stage: "pre_output_safety_gate",
    status: blockedReasons.length === 0 ? "passed" : "adjusted",
    adjusted_output: blockedReasons.length > 0 || highRisk || Boolean(highRiskEscalation?.triggered),
    blocked_reasons: unique(blockedReasons),
    warnings: unique(warnings),
    ...(highRiskEscalation?.triggered ? { escalation: highRiskEscalation } : {})
  };

  safeAnalysis.safety_gate = safetyGate;
  return {
    legalAnalysis: safeAnalysis,
    safetyGate
  };
}
