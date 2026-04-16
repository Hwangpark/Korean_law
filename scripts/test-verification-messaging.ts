import assert from "node:assert/strict";

import { buildVerificationHeadline, buildVerificationInterpretation } from "../apps/api/src/retrieval/verification.js";
import type { CandidateIssue, KeywordQueryPlan } from "../apps/api/src/retrieval/types.js";

function buildPlan(candidateIssues: CandidateIssue[]): KeywordQueryPlan {
  return {
    originalQuery: "카카오톡 단톡방 허위사실 유포",
    normalizedQuery: "카카오톡 단톡방 허위사실 유포",
    contextType: "messenger",
    tokens: ["카카오톡", "단톡방", "허위사실", "유포"],
    candidateIssues,
    broadLawQueries: ["명예훼손"],
    preciseLawQueries: ["명예훼손 허위사실 공연성"],
    broadPrecedentQueries: ["카카오톡 명예훼손"],
    precisePrecedentQueries: ["카카오톡 단톡방 허위사실 명예훼손"],
    lawQueries: ["명예훼손", "명예훼손 허위사실 공연성"],
    precedentQueries: ["카카오톡 명예훼손", "카카오톡 단톡방 허위사실 명예훼손"],
    warnings: [],
    supportedIssues: ["명예훼손"],
    unsupportedIssues: [],
    scopeWarnings: [],
    scopeFlags: {
      proceduralHeavy: false,
      insufficientFacts: false,
      unsupportedIssuePresent: false
    }
  };
}

function main(): void {
  const plan = buildPlan([{
    type: "명예훼손",
    severity: "high",
    matchedTerms: ["허위사실", "단톡방"],
    lawQueries: ["명예훼손 허위사실 공연성"],
    precedentQueries: ["카카오톡 단톡방 허위사실 명예훼손"],
    reason: "허위사실 적시와 공연성이 함께 보입니다."
  }]);

  const lowEvidenceHeadline = buildVerificationHeadline(plan, 2, {
    scopeAssessment: {
      procedural_heavy: false,
      insufficient_facts: true,
      warnings: []
    },
    evidenceStrength: "low"
  });
  assert.match(lowEvidenceHeadline, /사실관계가 부족해 참고 수준/, "headline should stay conservative when facts are insufficient.");

  const lowEvidenceInterpretation = buildVerificationInterpretation(plan, 2, {
    scopeAssessment: {
      procedural_heavy: false,
      insufficient_facts: true,
      warnings: []
    },
    evidenceStrength: "low"
  });
  assert.match(lowEvidenceInterpretation, /탐색적 검색/, "interpretation should downgrade to exploratory wording when facts are insufficient.");

  const proceduralInterpretation = buildVerificationInterpretation(plan, 2, {
    scopeAssessment: {
      procedural_heavy: true,
      insufficient_facts: false,
      warnings: []
    },
    evidenceStrength: "medium"
  });
  assert.match(proceduralInterpretation, /절차법/, "interpretation should flag procedural-heavy input.");

  process.stdout.write("Verification messaging checks passed.\n");
}

main();
