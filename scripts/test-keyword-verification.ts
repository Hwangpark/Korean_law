import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
  const samplePath = new URL("../fixtures/requests/sample-community.json", import.meta.url);
  const sample = JSON.parse(await readFile(samplePath, "utf8")) as { text?: string };
  const query = sample.text ?? "명예훼손 사기꾼 신상 전화번호";

  const verifyRes = await fetch(`${baseUrl}/api/retrieval/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      q: query,
      context_type: "community",
      provider_mode: "mock",
      limit: 4
    })
  });

  assert.equal(verifyRes.ok, true, `verify request failed with ${verifyRes.status}`);
  const verifyJson = (await verifyRes.json()) as {
    query_run?: { id?: string };
    verification?: { score?: number };
    reference_library?: { items?: unknown[] };
    law_search?: { laws?: unknown[] };
    precedent_search?: { precedents?: unknown[] };
  };

  assert.ok(verifyJson.query_run?.id, "query_run.id is missing");
  assert.ok(Array.isArray(verifyJson.reference_library?.items), "reference_library.items must be an array");
  assert.ok((verifyJson.reference_library?.items?.length ?? 0) > 0, "reference_library.items is empty");
  assert.ok((verifyJson.verification?.score ?? 0) >= 0, "verification score missing");

  const runRes = await fetch(`${baseUrl}/api/retrieval/runs/${encodeURIComponent(String(verifyJson.query_run?.id))}`);
  assert.equal(runRes.ok, true, `run detail request failed with ${runRes.status}`);
  const runJson = (await runRes.json()) as { run?: { id?: string }; hits?: unknown[] };
  assert.equal(runJson.run?.id, verifyJson.query_run?.id, "run detail id mismatch");
  assert.ok(Array.isArray(runJson.hits), "run hits must be an array");
  assert.ok((runJson.hits?.length ?? 0) > 0, "run hits is empty");

  const firstReference = verifyJson.reference_library?.items?.[0] as
    | { kind?: string; id?: string; title?: string }
    | undefined;
  assert.ok(firstReference?.kind && firstReference?.id, "first reference item missing kind/id");

  const detailRes = await fetch(`${baseUrl}/api/references/${firstReference.kind}/${encodeURIComponent(String(firstReference.id))}`);
  assert.equal(detailRes.ok, true, `reference detail request failed with ${detailRes.status}`);
  const detailJson = (await detailRes.json()) as { item?: { id?: string; kind?: string } };
  assert.equal(detailJson.item?.id, firstReference.id, "reference detail id mismatch");
  assert.equal(detailJson.item?.kind, firstReference.kind, "reference detail kind mismatch");

  const searchRes = await fetch(`${baseUrl}/api/references/search?q=${encodeURIComponent("명예훼손")}`);
  assert.equal(searchRes.ok, true, `reference search failed with ${searchRes.status}`);
  const searchJson = (await searchRes.json()) as { items?: unknown[] };
  assert.ok(Array.isArray(searchJson.items), "reference search items must be an array");

  console.log(
    JSON.stringify(
      {
        verifyStatus: verifyRes.status,
        runId: verifyJson.query_run?.id,
        referenceCount: verifyJson.reference_library?.items?.length ?? 0,
        hitCount: runJson.hits?.length ?? 0,
        searchCount: searchJson.items?.length ?? 0
      },
      null,
      2
    )
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

