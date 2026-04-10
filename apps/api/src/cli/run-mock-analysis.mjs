import path from "node:path";
import process from "node:process";

import { loadJson } from "../lib/load-json.mjs";
import { fromRepo } from "../lib/paths.mjs";
import { runAnalysis } from "../orchestrator/run-analysis.mjs";

function getArg(flag, defaultValue) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

async function main() {
  const fixtureArg = getArg("--fixture", "fixtures/requests/sample-community.json");
  const fixturePath = path.isAbsolute(fixtureArg) ? fixtureArg : fromRepo(fixtureArg);
  const request = await loadJson(fixturePath);
  const result = await runAnalysis(request, {
    providerMode: process.env.LAW_PROVIDER ?? "mock"
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
