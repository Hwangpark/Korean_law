import assert from "node:assert/strict";

import { buildJudgmentAxis } from "../apps/api/src/analysis/evidence.mjs";
import { buildJudgmentCore } from "../apps/api/src/analysis/judgment-core.mjs";

function main(): void {
  const strongJudgment = buildJudgmentCore({
    facts: {
      false_fact_signal: true,
      public_exposure: true,
      target_identifiable: true
    },
    charges: [
      { probability: "high" }
    ],
    scopeAssessment: {
      supported_issues: ["defamation"],
      unsupported_issues: [],
      procedural_heavy: false,
      insufficient_facts: false,
      unsupported_issue_present: false,
      warnings: []
    },
    groundingEvidence: {
      evidence_strength: "high"
    },
    baseRiskLevel: 3,
    issueCandidates: [
      {
        type: "defamation",
        severity: "high",
        matchedTerms: ["false fact"],
        lawQueries: [],
        precedentQueries: [],
        reason: "test"
      }
    ]
  });

  assert.equal(strongJudgment.can_sue, true);
  assert.equal(strongJudgment.evidence_strength, "high");
  assert.equal(strongJudgment.decision_axis.blocked_by_scope, false);
  assert.equal(strongJudgment.decision_axis.actionable_charge_count, 1);
  assert.ok(strongJudgment.risk_level >= 4);
  assert.ok(strongJudgment.recommended_actions.length > 0);
  assert.ok(strongJudgment.evidence_to_collect.length > 0);

  const blockedJudgment = buildJudgmentCore({
    facts: {
      false_fact_signal: true
    },
    charges: [
      { probability: "high" }
    ],
    scopeAssessment: {
      supported_issues: [],
      unsupported_issues: ["tax"],
      procedural_heavy: true,
      insufficient_facts: true,
      unsupported_issue_present: true,
      warnings: []
    },
    groundingEvidence: {
      evidence_strength: "high"
    },
    baseRiskLevel: 5
  });

  assert.equal(blockedJudgment.can_sue, false);
  assert.equal(blockedJudgment.risk_level, 2);
  assert.deepEqual(
    blockedJudgment.decision_axis.scope_block_reasons,
    ["procedural_heavy", "insufficient_facts", "unsupported_only"]
  );

  const legacyAxis = buildJudgmentAxis({
    facts: {
      false_fact_signal: true,
      public_exposure: true,
      target_identifiable: true
    },
    charges: [
      { probability: "high" }
    ],
    scopeAssessment: {
      supported_issues: ["defamation"],
      unsupported_issues: [],
      procedural_heavy: false,
      insufficient_facts: false,
      unsupported_issue_present: false,
      warnings: []
    },
    groundingEvidence: {
      evidence_strength: "high"
    },
    baseRiskLevel: 3
  });

  assert.equal(legacyAxis.can_sue, strongJudgment.can_sue);
  assert.equal(legacyAxis.risk_level, strongJudgment.risk_level);
  assert.equal(legacyAxis.decision_axis.evidence_strength, "high");

  console.log("Judgment core checks passed.");
}

main();
