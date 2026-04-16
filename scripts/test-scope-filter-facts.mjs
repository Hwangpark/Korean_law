import assert from "node:assert/strict";

import { buildScopeFilter } from "../apps/api/src/lib/scope-filter.mjs";

function verifyRichFactsPreventInsufficientFlag() {
  const result = buildScopeFilter(
    "짧은 입력",
    [],
    {
      text_length: 12,
      public_exposure: true,
      false_fact_signal: true,
      target_identifiable: true,
      personal_info_exposed: true
    }
  );

  assert.equal(
    result.scope_flags.insufficientFacts,
    false,
    "actionable fact signals should prevent insufficientFacts even when the text itself is short"
  );
  assert.equal(result.scope_flags.proceduralHeavy, false);
  assert.equal(result.scope_flags.unsupportedIssuePresent, false);
}

function verifySparseFactsStillEmitInsufficientWarning() {
  const result = buildScopeFilter("너 신고", [], {
    text_length: 4
  });

  assert.equal(result.scope_flags.insufficientFacts, true, "sparse text should remain insufficient");
  assert.ok(
    result.scope_warnings.some((warning) => warning.includes("사실관계")),
    "insufficient facts warning should stay visible"
  );
}

function verifyProceduralFactsDoNotDoublePunishScope() {
  const result = buildScopeFilter(
    "원심 파기환송 증거능력 공판기일 문제",
    [],
    {
      text_length: 22,
      procedural_signal: true
    }
  );

  assert.equal(result.scope_flags.proceduralHeavy, true, "procedural facts should trigger proceduralHeavy");
  assert.equal(
    result.scope_flags.insufficientFacts,
    false,
    "procedural-heavy inputs should not automatically become insufficient when they are otherwise explicit"
  );
}

verifyRichFactsPreventInsufficientFlag();
verifySparseFactsStillEmitInsufficientWarning();
verifyProceduralFactsDoNotDoublePunishScope();

process.stdout.write("Scope filter fact-aware checks passed.\n");
