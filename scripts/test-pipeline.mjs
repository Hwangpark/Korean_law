import assert from "node:assert/strict";

import { loadJson } from "../apps/api/src/lib/load-json.mjs";
import { fromRepo } from "../apps/api/src/lib/paths.mjs";
import { runAnalysis } from "../apps/api/src/orchestrator/run-analysis.mjs";

async function runCase(relativePath) {
  const request = await loadJson(fromRepo(relativePath));
  return runAnalysis(request, { providerMode: "mock" });
}

async function main() {
  const textResult = await runCase("fixtures/requests/sample-community.json");
  assert.ok(textResult.classification.issues.length >= 2, "text fixture should detect multiple issues");
  assert.ok(textResult.law_search.laws.length >= 2, "text fixture should map to laws");
  assert.ok(textResult.report.disclaimer.includes("법적 효력"), "report should include disclaimer");

  const imageResult = await runCase("fixtures/requests/sample-messenger-image.json");
  assert.equal(imageResult.ocr.source_type, "messenger");
  assert.ok(imageResult.precedent_search.precedents.length >= 1, "image fixture should find precedents");

  const agentsDone = imageResult.timeline.filter((event) => event.type === "agent_done").map((event) => event.agent);
  assert.deepEqual(
    agentsDone.sort(),
    ["analysis", "classifier", "law", "ocr", "precedent", "report"].sort(),
    "pipeline should complete every runtime agent stage"
  );

  process.stdout.write("Mock pipeline checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
