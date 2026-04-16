import type { CandidateIssue, ProfileContext } from "../retrieval/types.js";

export type JudgmentEvidenceStrength = "high" | "medium" | "low";

export interface JudgmentScopeAssessment {
  supported_issues: string[];
  unsupported_issues: string[];
  procedural_heavy: boolean;
  insufficient_facts: boolean;
  unsupported_issue_present: boolean;
  warnings: string[];
}

export interface JudgmentGroundingEvidence {
  evidence_strength?: JudgmentEvidenceStrength;
}

export interface JudgmentCharge {
  probability?: "high" | "medium" | "low";
}

export interface JudgmentCoreInput {
  facts?: Record<string, unknown>;
  charges?: JudgmentCharge[];
  scopeAssessment?: Partial<JudgmentScopeAssessment>;
  groundingEvidence?: JudgmentGroundingEvidence;
  baseRiskLevel?: number;
  issueCandidates?: CandidateIssue[];
  issueTypes?: Set<string> | string[];
  profileContext?: ProfileContext | null;
}

export interface JudgmentCoreResult {
  can_sue: boolean;
  risk_level: number;
  evidence_strength: JudgmentEvidenceStrength;
  scope_assessment: JudgmentScopeAssessment;
  recommended_actions: string[];
  evidence_to_collect: string[];
  profile_considerations: string[];
  decision_axis: {
    blocked_by_scope: boolean;
    scope_block_reasons: string[];
    evidence_strength: JudgmentEvidenceStrength;
    actionable_charge_count: number;
    fact_signal_count: number;
    supported_issue_count: number;
    base_risk_level: number;
    fact_risk_boost: number;
  };
}

export function buildJudgmentCore(input?: JudgmentCoreInput): JudgmentCoreResult;

export function buildJudgmentProfileConsiderations(input?: {
  profileContext?: ProfileContext | null;
  facts?: Record<string, unknown>;
  issueTypes?: Set<string> | string[];
}): string[];
