import assert from "node:assert/strict";

import { runClassifierAgent } from "../apps/api/src/agents/classifier-agent.mjs";
import { buildClassifierFacts } from "../apps/api/src/lib/classification-facts.mjs";
import {
  SUPPORTED_ISSUE_TYPES,
  buildIssueHypotheses,
  buildLegalElements,
  buildScopeFlags,
  normalizeText
} from "../apps/api/src/lib/issue-catalog.mjs";
import { loadRepoJson } from "../apps/api/src/lib/load-json.mjs";
import { buildAnalysisRetrievalPlan } from "../apps/api/src/retrieval/planner.js";

type RequestFixture = {
  context_type?: string;
  text?: string;
};

async function loadTextFixture(path: string): Promise<{ contextType: string; text: string }> {
  const fixture = await loadRepoJson(path) as RequestFixture;
  return {
    contextType: String(fixture.context_type ?? "other"),
    text: String(fixture.text ?? "")
  };
}

function issueTypes(hypotheses: Array<{ type?: unknown }> | undefined): string[] {
  return Array.isArray(hypotheses)
    ? hypotheses.map((hypothesis) => String(hypothesis?.type ?? "").trim()).filter(Boolean)
    : [];
}

function asIssueLike(types: string[]): Array<{ type: string }> {
  return types.map((type) => ({ type }));
}

const DEFAMATION = SUPPORTED_ISSUE_TYPES[0];
const THREAT_EXTORTION = SUPPORTED_ISSUE_TYPES[1];
const PRIVACY_LEAK = SUPPORTED_ISSUE_TYPES[3];
const FRAUD = SUPPORTED_ISSUE_TYPES[5];

function assertContainsAll(actual: string[], expected: string[], message: string): void {
  const actualSet = new Set(actual);
  for (const value of expected) {
    assert.ok(actualSet.has(value), `${message}: missing ${value}`);
  }
}

async function classifyFixture(path: string) {
  const fixture = await loadTextFixture(path);
  const classification = await runClassifierAgent({
    source_type: fixture.contextType,
    raw_text: fixture.text,
    utterances: []
  });
  const plan = buildAnalysisRetrievalPlan(classification, fixture.contextType);

  return {
    fixture,
    classification,
    plan,
    detectedTypes: issueTypes(classification.issue_hypotheses),
    candidateTypes: plan.candidateIssues.map((issue) => issue.type)
  };
}

async function verifyDefamationPrivacyFixture(): Promise<void> {
  const fixture = await loadTextFixture("fixtures/requests/sample-mixed-defamation-privacy.json");
  const normalized = normalizeText(fixture.text);
  const hypotheses = buildIssueHypotheses(normalized, fixture.contextType);
  const types = issueTypes(hypotheses);
  const facts = buildClassifierFacts({ source_type: fixture.contextType, utterances: [] }, normalized, fixture.contextType);
  const legalElements = buildLegalElements(normalized, asIssueLike(types));

  assert.ok(types.includes("명예훼손"), "defamation+privacy fixture should surface 명예훼손");
  assert.ok(types.includes("개인정보 유출"), "defamation+privacy fixture should surface 개인정보 유출");
  assert.equal(facts.public_exposure, true, "defamation+privacy fixture should detect public exposure");
  assert.equal(facts.personal_info_exposed, true, "defamation+privacy fixture should detect personal info exposure");
  assert.equal(facts.false_fact_signal, true, "defamation+privacy fixture should detect false-fact signal");
  assert.equal(facts.target_identifiable, true, "defamation+privacy fixture should detect identifiable target");
  assert.equal(legalElements["명예훼손"]?.public_disclosure, true, "defamation legal elements should detect public disclosure");
  assert.equal(legalElements["명예훼손"]?.falsity_signal, true, "defamation legal elements should detect falsity");
  assert.equal(
    legalElements["개인정보 유출"]?.personal_identifier_present,
    true,
    "privacy legal elements should detect personal identifier exposure"
  );
}

async function verifyFraudThreatFixture(): Promise<void> {
  const fixture = await loadTextFixture("fixtures/requests/sample-mixed-fraud-threat.json");
  const normalized = normalizeText(fixture.text);
  const hypotheses = buildIssueHypotheses(normalized, fixture.contextType);
  const types = issueTypes(hypotheses);
  const facts = buildClassifierFacts({ source_type: fixture.contextType, utterances: [] }, normalized, fixture.contextType);
  const legalElements = buildLegalElements(normalized, asIssueLike(types));

  assert.ok(types.includes("사기"), "fraud+threat fixture should surface 사기");
  assert.ok(types.includes("협박/공갈"), "fraud+threat fixture should surface 협박/공갈");
  assert.equal(facts.money_request, true, "fraud+threat fixture should detect money request");
  assert.equal(facts.threat_signal, true, "fraud+threat fixture should detect threat");
  assert.equal(legalElements["사기"]?.financial_loss, true, "fraud legal elements should detect financial loss");
  assert.equal(
    legalElements["협박/공갈"]?.threat_of_harm,
    true,
    "threat legal elements should detect threat of harm"
  );
  assert.equal(
    legalElements["협박/공갈"]?.money_or_property_request,
    true,
    "threat legal elements should detect money/property request"
  );
}

async function verifyProceduralDefamationFixture(): Promise<void> {
  const fixture = await loadTextFixture("fixtures/requests/sample-mixed-procedural-defamation.json");
  const normalized = normalizeText(fixture.text);
  const hypotheses = buildIssueHypotheses(normalized, fixture.contextType);
  const types = issueTypes(hypotheses);
  const facts = buildClassifierFacts({ source_type: fixture.contextType, utterances: [] }, normalized, fixture.contextType);
  const scopeFlags = buildScopeFlags(normalized, types.length);

  assert.ok(types.includes("명예훼손"), "procedural+defamation fixture should keep the substantive 명예훼손 hypothesis");
  assert.equal(facts.procedural_signal, true, "procedural+defamation fixture should detect procedural language");
  assert.equal(scopeFlags.proceduralHeavy, true, "procedural+defamation fixture should be flagged as procedural-heavy");
}

async function verifyWeakEvidenceFixture(): Promise<void> {
  const fixture = await loadTextFixture("fixtures/requests/sample-weak-evidence.json");
  const normalized = normalizeText(fixture.text);
  const hypotheses = buildIssueHypotheses(normalized, fixture.contextType);
  const types = issueTypes(hypotheses);
  const facts = buildClassifierFacts({ source_type: fixture.contextType, utterances: [] }, normalized, fixture.contextType);
  const scopeFlags = buildScopeFlags(normalized, types.length);

  assert.deepEqual(types, [], "weak-evidence fixture should not create supported issue hypotheses");
  assert.equal(scopeFlags.insufficientFacts, true, "weak-evidence fixture should be marked insufficient");
  assert.equal(facts.insulting_expression, false, "weak-evidence fixture should not overfire insult detection");
  assert.equal(facts.false_fact_signal, false, "weak-evidence fixture should not overfire falsity detection");
}

async function verifyUnsupportedMixedFixture(): Promise<void> {
  const fixture = await loadTextFixture("fixtures/requests/sample-mixed-unsupported-defamation.json");
  const normalized = normalizeText(fixture.text);
  const hypotheses = buildIssueHypotheses(normalized, fixture.contextType);
  const types = issueTypes(hypotheses);
  const facts = buildClassifierFacts({ source_type: fixture.contextType, utterances: [] }, normalized, fixture.contextType);
  const scopeFlags = buildScopeFlags(normalized, types.length);

  assert.ok(types.includes("명예훼손"), "unsupported+defamation fixture should still keep supported 명예훼손");
  assert.equal(
    facts.unsupported_issue_signal,
    true,
    "unsupported+defamation fixture should mark unsupported issue signal"
  );
  assert.equal(
    scopeFlags.unsupportedIssuePresent,
    true,
    "unsupported+defamation fixture should be marked as containing unsupported issues"
  );
}

async function verifyDefamationPrivacyPlannerBoundary(): Promise<void> {
  const { classification, plan, detectedTypes, candidateTypes } = await classifyFixture(
    "fixtures/requests/sample-mixed-defamation-privacy.json"
  );

  assertContainsAll(
    detectedTypes,
    [DEFAMATION, PRIVACY_LEAK],
    "classifier should preserve both defamation and privacy hypotheses"
  );
  assertContainsAll(
    candidateTypes,
    [DEFAMATION, PRIVACY_LEAK],
    "analysis retrieval plan should preserve both defamation and privacy candidates"
  );
  assert.equal(classification.scope_flags.insufficientFacts, false, "rich mixed fixture should not be insufficient");
  assert.equal(plan.scopeFlags.insufficientFacts, false, "planner should not downgrade rich mixed fixture");
  assert.deepEqual(plan.unsupportedIssues, [], "supported mixed fixture should not expose unsupported issues");
  assert.ok(
    plan.lawQueryRefs?.some((ref) => ref.issue_types?.includes(DEFAMATION) && ref.sources?.includes("legal_element")),
    "defamation query refs should include legal-element provenance"
  );
  assert.ok(
    plan.lawQueryRefs?.some((ref) => ref.issue_types?.includes(PRIVACY_LEAK) && ref.sources?.includes("legal_element")),
    "privacy query refs should include legal-element provenance"
  );
}

async function verifyFraudThreatPlannerBoundary(): Promise<void> {
  const { classification, plan, detectedTypes, candidateTypes } = await classifyFixture(
    "fixtures/requests/sample-mixed-fraud-threat.json"
  );

  assertContainsAll(
    detectedTypes,
    [FRAUD, THREAT_EXTORTION],
    "classifier should preserve both fraud and threat/extortion hypotheses"
  );
  assertContainsAll(
    candidateTypes,
    [FRAUD, THREAT_EXTORTION],
    "analysis retrieval plan should preserve both fraud and threat/extortion candidates"
  );
  assert.equal(classification.facts.money_request, true, "fraud+threat fixture should keep money request facts");
  assert.equal(classification.facts.threat_signal, true, "fraud+threat fixture should keep threat facts");
  assert.equal(plan.scopeFlags.insufficientFacts, false, "planner should not mark actionable fraud+threat as insufficient");
  assert.ok(
    plan.preciseLawQueries.some((query) => query.includes(FRAUD)),
    "fraud candidate should contribute precise law queries"
  );
  assert.ok(
    plan.preciseLawQueries.some((query) => query.includes(THREAT_EXTORTION)),
    "threat/extortion candidate should contribute precise law queries"
  );
}

async function verifyProceduralSubstantivePlannerBoundary(): Promise<void> {
  const { classification, plan, detectedTypes, candidateTypes } = await classifyFixture(
    "fixtures/requests/sample-mixed-procedural-defamation.json"
  );

  assertContainsAll(
    detectedTypes,
    [DEFAMATION],
    "procedural+substantive fixture should keep the supported substantive hypothesis"
  );
  assertContainsAll(
    candidateTypes,
    [DEFAMATION],
    "planner should keep the supported substantive candidate in procedural mixed input"
  );
  assert.equal(classification.scope_flags.proceduralHeavy, true, "classifier should flag procedural language");
  assert.equal(plan.scopeFlags.proceduralHeavy, true, "planner should preserve procedural flag");
  assert.equal(plan.scopeFlags.unsupportedIssuePresent, false, "procedural mixed fixture is not unsupported");
  assert.ok(plan.scopeWarnings.length >= 1, "procedural mixed fixture should preserve a scope warning");
}

async function verifySupportedUnsupportedPlannerBoundary(): Promise<void> {
  const { classification, plan, detectedTypes, candidateTypes } = await classifyFixture(
    "fixtures/requests/sample-mixed-unsupported-defamation.json"
  );

  assertContainsAll(
    detectedTypes,
    [DEFAMATION],
    "supported+unsupported fixture should keep supported defamation hypothesis"
  );
  assertContainsAll(
    candidateTypes,
    [DEFAMATION],
    "planner should keep supported defamation candidate despite unsupported signal"
  );
  assert.equal(classification.scope_flags.unsupportedIssuePresent, true, "classifier should flag unsupported issue");
  assert.equal(plan.scopeFlags.unsupportedIssuePresent, true, "planner should preserve unsupported flag");
  assert.ok(plan.unsupportedIssues.length >= 1, "planner should expose unsupported issue keywords separately");
  assert.ok(plan.scopeWarnings.length >= 1, "supported+unsupported fixture should preserve a scope warning");
}

async function main(): Promise<void> {
  await verifyDefamationPrivacyFixture();
  await verifyFraudThreatFixture();
  await verifyProceduralDefamationFixture();
  await verifyWeakEvidenceFixture();
  await verifyUnsupportedMixedFixture();
  await verifyDefamationPrivacyPlannerBoundary();
  await verifyFraudThreatPlannerBoundary();
  await verifyProceduralSubstantivePlannerBoundary();
  await verifySupportedUnsupportedPlannerBoundary();

  process.stdout.write("Mixed-case fixture checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
