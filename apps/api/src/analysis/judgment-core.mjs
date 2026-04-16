import {
  buildEvidenceToCollect,
  buildProfileConsiderations,
  buildRecommendedActions
} from "./guidance-policy.mjs";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeFacts(facts = {}) {
  return facts && typeof facts === "object" ? facts : {};
}

function normalizeScopeAssessment(scopeAssessment = {}) {
  return {
    supported_issues: Array.isArray(scopeAssessment?.supported_issues)
      ? scopeAssessment.supported_issues
      : [],
    unsupported_issues: Array.isArray(scopeAssessment?.unsupported_issues)
      ? scopeAssessment.unsupported_issues
      : [],
    procedural_heavy: Boolean(scopeAssessment?.procedural_heavy),
    insufficient_facts: Boolean(scopeAssessment?.insufficient_facts),
    unsupported_issue_present: Boolean(scopeAssessment?.unsupported_issue_present),
    warnings: Array.isArray(scopeAssessment?.warnings) ? scopeAssessment.warnings : []
  };
}

function getIssueTypes(issueCandidates = [], explicitIssueTypes) {
  if (explicitIssueTypes instanceof Set) {
    return explicitIssueTypes;
  }

  if (Array.isArray(explicitIssueTypes)) {
    return new Set(explicitIssueTypes.filter(Boolean));
  }

  return new Set(
    (issueCandidates ?? [])
      .map((issue) => String(issue?.type ?? "").trim())
      .filter(Boolean)
  );
}

function getActionableChargeCount(charges = []) {
  return (charges ?? []).filter((charge) => charge?.probability && charge.probability !== "low").length;
}

function getFactActionabilitySignals(facts) {
  return [
    facts.false_fact_signal,
    facts.insulting_expression,
    facts.threat_signal,
    facts.money_request,
    facts.personal_info_exposed,
    facts.repeated_contact,
    facts.public_exposure && facts.target_identifiable
  ].filter(Boolean).length;
}

function getFactsRiskBoost(facts) {
  let risk = 0;

  if (facts.threat_signal) risk += 2;
  if (facts.personal_info_exposed) risk += 1;
  if (facts.repeated_contact) risk += 1;
  if (facts.money_request) risk += 1;
  if (facts.public_exposure) risk += 1;

  return risk;
}

function getScopeBlockReasons(scopeAssessment, supportedIssueCount) {
  const reasons = [];

  if (scopeAssessment.procedural_heavy) {
    reasons.push("procedural_heavy");
  }
  if (scopeAssessment.insufficient_facts) {
    reasons.push("insufficient_facts");
  }
  if (scopeAssessment.unsupported_issue_present && supportedIssueCount === 0) {
    reasons.push("unsupported_only");
  }

  return reasons;
}

function normalizeEvidenceStrength(groundingEvidence) {
  const value = groundingEvidence?.evidence_strength;
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

export function buildJudgmentCore({
  facts,
  charges = [],
  scopeAssessment,
  groundingEvidence,
  baseRiskLevel = 1,
  issueCandidates = [],
  issueTypes,
  profileContext
} = {}) {
  const normalizedFacts = normalizeFacts(facts);
  const normalizedScope = normalizeScopeAssessment(scopeAssessment);
  const normalizedIssueTypes = getIssueTypes(issueCandidates, issueTypes);
  const supportedIssueCount = normalizedScope.supported_issues.length;
  const actionableChargeCount = getActionableChargeCount(charges);
  const factSignalCount = getFactActionabilitySignals(normalizedFacts);
  const evidenceStrength = normalizeEvidenceStrength(groundingEvidence);
  const scopeBlockReasons = getScopeBlockReasons(normalizedScope, supportedIssueCount);
  const blockedByScope = scopeBlockReasons.length > 0;
  const hasSupportedEvidence = evidenceStrength !== "low";

  const canSue = !blockedByScope && (
    (actionableChargeCount > 0 && hasSupportedEvidence) ||
    (factSignalCount >= 2 && hasSupportedEvidence) ||
    evidenceStrength === "high"
  );

  const numericBaseRisk = Number.isFinite(Number(baseRiskLevel)) ? Number(baseRiskLevel) : 1;
  const factRiskBoost = getFactsRiskBoost(normalizedFacts);
  let riskLevel = Math.min(5, Math.max(1, numericBaseRisk + factRiskBoost));

  if (blockedByScope) {
    riskLevel = Math.min(riskLevel, 2);
  } else if (evidenceStrength === "low") {
    riskLevel = Math.max(1, riskLevel - 1);
  } else if (evidenceStrength === "high" && actionableChargeCount > 0) {
    riskLevel = Math.min(5, riskLevel + 1);
  }

  const guidanceInput = {
    scopeAssessment: normalizedScope,
    facts: normalizedFacts,
    issueCandidates,
    issueTypes: normalizedIssueTypes
  };

  return {
    can_sue: canSue,
    risk_level: riskLevel,
    evidence_strength: evidenceStrength,
    scope_assessment: normalizedScope,
    recommended_actions: buildRecommendedActions(guidanceInput),
    evidence_to_collect: buildEvidenceToCollect(guidanceInput),
    profile_considerations: buildProfileConsiderations({
      profileContext,
      facts: normalizedFacts,
      issueTypes: normalizedIssueTypes
    }),
    decision_axis: {
      blocked_by_scope: blockedByScope,
      scope_block_reasons: scopeBlockReasons,
      evidence_strength: evidenceStrength,
      actionable_charge_count: actionableChargeCount,
      fact_signal_count: factSignalCount,
      supported_issue_count: supportedIssueCount,
      base_risk_level: numericBaseRisk,
      fact_risk_boost: factRiskBoost
    }
  };
}

export function buildJudgmentProfileConsiderations({ profileContext, facts = {}, issueTypes = new Set() } = {}) {
  return unique(buildProfileConsiderations({ profileContext, facts, issueTypes }));
}
