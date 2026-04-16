import assert from "node:assert/strict";

import { runClassifierAgent } from "../apps/api/src/agents/classifier-agent.mjs";
import { normalizeGuidedClassifierExtraction } from "../apps/api/src/lib/classification-facts.mjs";
import { SUPPORTED_ISSUE_TYPES } from "../apps/api/src/lib/issue-catalog.mjs";
import { buildScopeFilter } from "../apps/api/src/lib/scope-filter.mjs";
import { buildAnalysisRetrievalPlan, buildKeywordQueryPlan } from "../apps/api/src/retrieval/planner.js";

type ClassifierResult = Awaited<ReturnType<typeof runClassifierAgent>>;

function toSet(values: string[]): Set<string> {
  return new Set(values);
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))]
    : [];
}

function issueTypes(result: Pick<ClassifierResult, "issue_hypotheses">): string[] {
  return uniqueStrings(
    result.issue_hypotheses?.map((hypothesis) =>
      hypothesis && typeof hypothesis === "object" && "type" in hypothesis ? hypothesis.type : null
    )
  );
}

function assertContainsAll(actual: string[], expected: string[], message: string): void {
  const actualSet = toSet(actual);
  for (const value of expected) {
    assert.ok(actualSet.has(value), `${message}: missing ${value}`);
  }
}

async function verifyMultiIssueBridge(): Promise<void> {
  const classification = await runClassifierAgent({
    source_type: "messenger",
    raw_text:
      "카카오톡 단톡방에 허위사실을 올리고 실명과 전화번호를 공개했다. " +
      "돈 안 주면 집 앞에 찾아가서 죽이겠다고 하고, 그 뒤로 계속 연락한다.",
    utterances: []
  });

  const detectedTypes = issueTypes(classification);
  assertContainsAll(
    detectedTypes,
    ["명예훼손", "개인정보 유출", "협박/공갈", "스토킹"],
    "multi-issue classification should keep all major hypotheses"
  );

  assert.equal(classification.facts.public_exposure, true, "facts should detect public exposure");
  assert.equal(classification.facts.personal_info_exposed, true, "facts should detect personal info exposure");
  assert.equal(classification.facts.threat_signal, true, "facts should detect threat signal");
  assert.equal(classification.facts.repeated_contact, true, "facts should detect repeated contact");

  const legalElements = classification.legal_elements as Record<string, Record<string, boolean>>;
  assert.equal(legalElements["명예훼손"]?.public_disclosure, true, "defamation should detect public disclosure");
  assert.equal(legalElements["명예훼손"]?.falsity_signal, true, "defamation should detect falsity");
  assert.equal(
    legalElements["개인정보 유출"]?.personal_identifier_present,
    true,
    "privacy leak should detect personal identifiers"
  );
  assert.equal(legalElements["협박/공갈"]?.threat_of_harm, true, "threat should detect harm language");
  assert.equal(legalElements["스토킹"]?.repeated_contact, true, "stalking should detect repeated contact");

  assert.deepEqual(classification.supported_issues, detectedTypes, "classifier should expose supported issues");
  assert.deepEqual(classification.unsupported_issues, [], "in-scope text should not expose unsupported issues");
  assert.equal(classification.scope_flags.proceduralHeavy, false, "multi-issue text should not be procedural");
  assert.equal(classification.scope_flags.unsupportedIssuePresent, false, "multi-issue text should stay in scope");
  assert.deepEqual(classification.scope_warnings, [], "rich in-scope text should not emit scope warnings");

  const keywordPlan = buildKeywordQueryPlan(
    "단톡방 허위사실 전화번호 공개 돈 안 주면 죽이겠다 계속 연락",
    "messenger"
  );
  const analysisPlan = buildAnalysisRetrievalPlan(classification, "messenger");

  assertContainsAll(
    analysisPlan.candidateIssues.map((issue) => issue.type),
    detectedTypes,
    "analysis retrieval plan should preserve classifier issue hypotheses"
  );
  const defamationCandidate = analysisPlan.candidateIssues.find((issue) => issue.type === "명예훼손");
  assert.ok(defamationCandidate, "analysis retrieval plan should keep the defamation candidate");
  assert.ok(
    defamationCandidate?.legalElementSignals?.includes("public_disclosure"),
    "analysis retrieval plan should preserve legal element signals on candidate issues"
  );
  assert.ok(
    defamationCandidate?.querySources?.includes("legal_element"),
    "analysis retrieval plan should track legal-element query provenance"
  );
  assertContainsAll(
    analysisPlan.supportedIssues,
    detectedTypes,
    "analysis retrieval plan should expose supported issues"
  );
  assert.deepEqual(analysisPlan.unsupportedIssues, [], "analysis retrieval plan should keep unsupported issues empty");
  assert.ok(
    analysisPlan.preciseLawQueries.length >= keywordPlan.preciseLawQueries.length,
    "analysis retrieval plan should keep or expand precise law queries"
  );
  assert.ok(
    analysisPlan.precisePrecedentQueries.length >= keywordPlan.precisePrecedentQueries.length,
    "analysis retrieval plan should keep or expand precise precedent queries"
  );

  const lawHintBroad = uniqueStrings(classification.query_hints?.law?.broad);
  const lawHintPrecise = uniqueStrings(classification.query_hints?.law?.precise);
  const precedentHintPrecise = uniqueStrings(classification.query_hints?.precedent?.precise);

  assertContainsAll(
    analysisPlan.broadLawQueries,
    lawHintBroad,
    "analysis retrieval plan should carry broad law query hints"
  );
  assertContainsAll(
    analysisPlan.preciseLawQueries,
    lawHintPrecise,
    "analysis retrieval plan should carry precise law query hints"
  );
  assertContainsAll(
    analysisPlan.precisePrecedentQueries,
    precedentHintPrecise,
    "analysis retrieval plan should carry precise precedent query hints"
  );
  assertContainsAll(
    analysisPlan.preciseLawQueries,
    ["명예훼손 공연성", "명예훼손 허위사실", "명예훼손 허위사실 공연성"],
    "analysis retrieval plan should add legal-element-aware precise law queries"
  );
  assert.equal(analysisPlan.scopeFlags.proceduralHeavy, false, "analysis plan should preserve non-procedural scope");
}

async function verifyProceduralHeavyTextStaysOutOfSupportedRouting(): Promise<void> {
  const classification = await runClassifierAgent({
    source_type: "community",
    raw_text: "상고 이유로 파기환송하고 공판기일 전 증거조사와 증거능력이 문제된 판결문 요지다.",
    utterances: []
  });

  assert.equal(classification.scope_flags.proceduralHeavy, true, "procedural text should be flagged");
  assert.equal(classification.facts.procedural_signal, true, "facts should capture procedural signal");
  assert.equal(classification.scope_flags.insufficientFacts, false, "procedural-heavy text should not also be downgraded as missing facts by default");
  assert.equal(classification.scope_flags.unsupportedIssuePresent, false, "procedural text alone is not unsupported");
  assert.equal(
    classification.scope_flags.insufficientFacts,
    false,
    "procedural-heavy text should not automatically be treated as insufficient facts"
  );
  assert.deepEqual(issueTypes(classification), [], "procedural text should not produce supported issue hypotheses");
  assert.ok(classification.scope_warnings.length >= 1, "procedural text should emit scope warnings");

  const analysisPlan = buildAnalysisRetrievalPlan(classification, "community");
  assert.equal(analysisPlan.scopeFlags.proceduralHeavy, true, "analysis plan should preserve procedural flag");
  assert.ok(
    analysisPlan.candidateIssues.every((issue) => !SUPPORTED_ISSUE_TYPES.includes(issue.type)),
    "procedural-only text should not be routed into supported criminal issue buckets"
  );
  assert.ok(analysisPlan.scopeWarnings.length >= 1, "analysis plan should preserve scope warnings");
}

async function verifyShortActionableTextAvoidsInsufficientFacts(): Promise<void> {
  const classification = await runClassifierAgent({
    source_type: "messenger",
    raw_text: "돈 안 주면 찾아가서 죽인다",
    utterances: []
  });

  assert.equal(classification.facts.threat_signal, true, "short actionable text should keep threat signal");
  assert.equal(classification.facts.money_request, true, "short actionable text should keep money-request signal");
  assert.equal(
    classification.scope_flags.insufficientFacts,
    false,
    "short text with strong actionable facts should not be treated as insufficient"
  );
}

async function verifySemanticInsultBridgeDoesNotRequireCategoryKeyword(): Promise<void> {
  const classification = await runClassifierAgent({
    source_type: "game_chat",
    raw_text: "야 너거매 진짜 역겹다",
    utterances: []
  });

  assert.equal(classification.facts.family_directed_insult, true, "facts should detect compressed family-directed insult");
  assert.equal(classification.facts.insulting_expression, true, "facts should promote semantic insult signal");
  assert.equal(
    classification.scope_flags.insufficientFacts,
    false,
    "short text with semantic insult facts should not be treated as insufficient"
  );

  const detectedTypes = issueTypes(classification);
  assertContainsAll(detectedTypes, ["모욕"], "semantic insult should produce insult retrieval hypothesis");

  const insultHypothesis = classification.issue_hypotheses.find((hypothesis) => hypothesis.type === "모욕");
  assert.ok(insultHypothesis, "semantic insult should keep an insult hypothesis");
  assert.ok(
    Array.isArray(insultHypothesis?.sources) && insultHypothesis.sources.includes("fact"),
    "semantic insult hypothesis should preserve fact provenance"
  );

  const legalElements = classification.legal_elements as Record<string, Record<string, boolean>>;
  assert.equal(legalElements["모욕"]?.insulting_expression, true, "legal elements should reuse facts-first insult signal");
  assert.equal(legalElements["모욕"]?.family_directed_insult, true, "legal elements should expose family-directed insult fact");

  const analysisPlan = buildAnalysisRetrievalPlan(classification, "game_chat");
  const insultCandidate = analysisPlan.candidateIssues.find((issue) => issue.type === "모욕");
  assert.ok(insultCandidate, "retrieval plan should keep semantic insult candidate");
  assert.ok(
    insultCandidate?.querySources?.includes("fact"),
    "retrieval plan should preserve fact query provenance"
  );

  const benign = await runClassifierAgent({
    source_type: "game_chat",
    raw_text: "우리 엄마가 밥 먹으라고 했다",
    utterances: []
  });
  assert.equal(benign.facts.family_directed_insult, false, "benign family reference should not be treated as insult");
  assert.equal(issueTypes(benign).includes("모욕"), false, "benign family reference should not produce insult hypothesis");
}

async function verifyCanonicalIssueLabelsAndFraudAccusationBoundary(): Promise<void> {
  assert.deepEqual(
    SUPPORTED_ISSUE_TYPES,
    ["명예훼손", "협박/공갈", "모욕", "개인정보 유출", "스토킹", "사기"],
    "supported issue labels should stay canonical UTF-8 Korean"
  );

  const accusation = await runClassifierAgent({
    source_type: "community",
    raw_text:
      "단톡방에 저를 사기꾼이라고 허위사실을 올리고 거래 사기라고 퍼뜨렸습니다. " +
      "실제로 돈을 받은 적도 없는데 커뮤니티에 계속 공개합니다.",
    utterances: []
  });
  const accusationTypes = issueTypes(accusation);
  assert.ok(
    accusationTypes.includes("명예훼손"),
    "false public fraud accusation should stay routed as defamation"
  );
  assert.equal(
    accusationTypes.includes("사기"),
    false,
    "false public fraud accusation should not become an actual fraud hypothesis"
  );

  const realFraud = await runClassifierAgent({
    source_type: "messenger",
    raw_text: "중고거래에서 물건값을 입금했는데 돈만 받고 잠수했고 환불을 안 해줍니다.",
    utterances: []
  });
  assert.ok(
    issueTypes(realFraud).includes("사기"),
    "money/property transfer plus deception should still produce fraud hypothesis"
  );
}

function verifyGuidedExtractionParserKeepsLlmProvenance(): void {
  const parsed = normalizeGuidedClassifierExtraction(
    {
      facts: {
        insulting_expression: true,
        family_directed_insult: true,
        semantic_signals: ["family_directed_insult"]
      },
      issue_hypotheses: [
        {
          type: "모욕",
          confidence: 0.91,
          matched_terms: ["가족비하 의미"],
          reason: "표면 키워드가 아니라 가족비하 의미가 확인됨"
        },
        {
          type: "상상죄",
          confidence: 1,
          matched_terms: ["drop me"]
        }
      ],
      legal_elements: {
        모욕: {
          insulting_expression: true,
          family_directed_insult: true
        }
      },
      query_hints: {
        law: {
          broad: ["모욕"],
          precise: ["모욕 경멸적 표현 가족비하"]
        },
        precedent: {
          broad: ["게임 채팅 모욕"],
          precise: ["게임 채팅 패드립 모욕"]
        }
      }
    },
    {
      source_type: "game_chat",
      context_type: "game_chat",
      utterance_count: 0,
      text_length: 12
    },
    "game_chat"
  );

  assert.equal(parsed.facts.insulting_expression, true, "guided parser should preserve LLM fact booleans");
  assert.deepEqual(
    parsed.issue_hypotheses.map((hypothesis) => hypothesis.type),
    ["모욕"],
    "guided parser should keep only supported issue hypotheses"
  );
  assert.equal(parsed.issue_hypotheses[0]?.source, "llm", "guided hypotheses should be marked as LLM sourced");
  assert.deepEqual(parsed.issue_hypotheses[0]?.sources, ["llm"], "guided hypotheses should preserve LLM provenance");
  assert.equal(
    parsed.query_hints.law.precise.includes("모욕 경멸적 표현 가족비하"),
    true,
    "guided parser should preserve precise law query hints"
  );
}

function verifyGuidedWarningsReachScopeFilter(): void {
  const supportedType = SUPPORTED_ISSUE_TYPES[0];
  const parsed = normalizeGuidedClassifierExtraction(
    {
      facts: {
        public_exposure: true,
        target_identifiable: true
      },
      issue_hypotheses: [
        {
          type: supportedType,
          confidence: 0.82,
          matched_terms: ["public post"],
          reason: "supported issue"
        },
        {
          type: "imaginary-crime",
          confidence: 1,
          matched_terms: ["unsupported"]
        }
      ],
      warnings: ["imaginary-crime is outside the supported issue set"]
    },
    {
      source_type: "community",
      context_type: "community",
      utterance_count: 1,
      text_length: 80
    },
    "community"
  );

  assert.equal(parsed.facts.unsupported_issue_signal, true, "filtered unsupported issue should set unsupported fact signal");
  assert.deepEqual(parsed.unsupported_issue_types, ["imaginary-crime"], "parser should retain unsupported issue labels");
  assert.ok(
    parsed.warnings.some((warning) => warning.includes("imaginary-crime")),
    "parser should retain LLM unsupported warnings"
  );
  assert.deepEqual(
    parsed.issue_hypotheses.map((hypothesis) => hypothesis.type),
    [supportedType],
    "parser should still filter unsupported issue hypotheses from supported routing"
  );

  const scopeFilter = buildScopeFilter("public post with unsupported issue guidance", [supportedType], parsed.facts, {
    warnings: parsed.warnings,
    unsupportedIssues: parsed.unsupported_issue_types
  });

  assert.equal(
    scopeFilter.scope_flags.unsupportedIssuePresent,
    true,
    "scope filter should use guided unsupported signals"
  );
  assert.ok(
    scopeFilter.unsupported_issues.includes("imaginary-crime"),
    "scope filter should expose guided unsupported labels"
  );
  assert.ok(
    scopeFilter.scope_warnings.some((warning) => warning.includes("imaginary-crime")),
    "scope filter should preserve guided warnings"
  );
}

async function verifyUnsupportedIssueFlagging(): Promise<void> {
  const classification = await runClassifierAgent({
    source_type: "messenger",
    raw_text: "강간과 불법촬영 혐의만 적힌 판결문 요약이다.",
    utterances: []
  });

  assert.equal(
    classification.scope_flags.unsupportedIssuePresent,
    true,
    "unsupported criminal issues should be flagged for downstream scope filtering"
  );
  assert.equal(
    classification.scope_flags.insufficientFacts,
    false,
    "unsupported-only text should not automatically be treated as insufficient when the issue itself is explicit"
  );
  assert.ok(
    classification.unsupported_issues.length >= 1,
    "unsupported-only text should expose unsupported issue keywords"
  );
  assert.deepEqual(
    issueTypes(classification),
    [],
    "unsupported-only text should not be converted into supported issue hypotheses"
  );
}

async function main(): Promise<void> {
  verifyGuidedExtractionParserKeepsLlmProvenance();
  verifyGuidedWarningsReachScopeFilter();
  await verifyMultiIssueBridge();
  await verifyProceduralHeavyTextStaysOutOfSupportedRouting();
  await verifyShortActionableTextAvoidsInsufficientFacts();
  await verifySemanticInsultBridgeDoesNotRequireCategoryKeyword();
  await verifyCanonicalIssueLabelsAndFraudAccusationBoundary();
  await verifyUnsupportedIssueFlagging();
  process.stdout.write("Classification/retrieval bridge checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
