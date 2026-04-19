import assert from "node:assert/strict";

import { runGuidedExtractionAgent } from "../apps/api/src/agents/guided-extraction-agent.mjs";

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_CLASSIFIER_ENABLED",
  "OPENAI_CLASSIFIER_MODEL",
  "OPENAI_CLASSIFIER_TIMEOUT_MS",
  "OPENAI_CLASSIFIER_MAX_INPUT_CHARS",
  "OPENAI_CLASSIFIER_MAX_OUTPUT_TOKENS",
  "OPENAI_CLASSIFIER_REASONING_EFFORT",
  "OPENAI_BASE_URL"
] as const;

function snapshotEnv(): EnvSnapshot {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function validExtractionPayload(): Record<string, unknown> {
  return {
    facts: {
      public_exposure: true,
      direct_message: false,
      repeated_contact: false,
      threat_signal: false,
      money_request: false,
      personal_info_exposed: false,
      insulting_expression: true,
      family_directed_insult: true,
      slang_or_obfuscated_expression: true,
      false_fact_signal: false,
      target_identifiable: true,
      procedural_signal: false,
      unsupported_issue_signal: false,
      abusive_expression_types: ["family_directed_insult"],
      semantic_signals: ["insulting_expression", "family_directed_insult"],
      detected_keywords: []
    },
    issue_hypotheses: [
      {
        type: "모욕",
        confidence: 0.86,
        matched_terms: ["가족 비하 표현"],
        reason: "상대방을 경멸하는 가족 비하 표현으로 해석됩니다."
      }
    ],
    legal_elements: [
      {
        issue_type: "모욕",
        element_signals: ["insulting_expression", "family_directed_insult"],
        reason: "경멸적 표현 신호가 있습니다."
      }
    ],
    query_hints: {
      broad: ["모욕"],
      precise: ["모욕 가족 비하 표현"],
      law: {
        broad: ["모욕"],
        precise: ["모욕 공연성 경멸 표현"]
      },
      precedent: {
        broad: ["게임 채팅 모욕"],
        precise: ["게임 채팅 가족 비하 모욕"]
      }
    },
    warnings: []
  };
}

async function withMockedFetch(
  fetchImpl: typeof fetch,
  run: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyDisabledWithoutApiKey(): Promise<void> {
  const env = snapshotEnv();
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_CLASSIFIER_ENABLED = "1";

    const result = await runGuidedExtractionAgent({
      searchableText: "너거매 진짜 역겹다",
      contextType: "game_chat",
      signalHints: {}
    });

    assert.equal(result.mode, "rule_fallback");
    assert.equal(result.model, null);
    assert.equal(result.extraction, null);
    assert.match(String(result.warning), /OPENAI_API_KEY/);
  } finally {
    restoreEnv(env);
  }
}

async function verifyStructuredResponseRequestAndSuccess(): Promise<void> {
  const env = snapshotEnv();
  const requests: Record<string, unknown>[] = [];
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_CLASSIFIER_ENABLED = "1";
    process.env.OPENAI_CLASSIFIER_MODEL = "gpt-5-nano";
    process.env.OPENAI_CLASSIFIER_REASONING_EFFORT = "minimal";

    await withMockedFetch(
      (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return jsonResponse({
          output_text: JSON.stringify(validExtractionPayload())
        });
      }) as typeof fetch,
      async () => {
        const result = await runGuidedExtractionAgent({
          searchableText: "너거매 진짜 역겹다",
          contextType: "game_chat",
          signalHints: {
            insulting_expression: true,
            family_directed_insult: true
          }
        });

        assert.equal(result.mode, "openai");
        assert.equal(result.model, "gpt-5-nano");
        assert.equal(result.warning, null);
        assert.equal(result.extraction?.facts.insulting_expression, true);
        assert.equal(result.extraction?.issue_hypotheses[0]?.source, "llm");
        assert.equal(result.extraction?.legal_elements["모욕"]?.insulting_expression, true);
      }
    );

    assert.equal(requests.length, 1, "OpenAI classifier should issue exactly one request");
    const request = requests[0] ?? {};
    assert.equal(request.model, "gpt-5-nano");
    assert.deepEqual(request.reasoning, { effort: "minimal" });
    const input = request.input as Array<Record<string, unknown>>;
    assert.match(
      String(input?.[0]?.content ?? ""),
      /너거매/,
      "system prompt should include readable Korean slang interpretation guidance"
    );

    const text = request.text as Record<string, unknown>;
    const format = text?.format as Record<string, unknown>;
    assert.equal(format?.type, "json_schema", "Responses request should use structured outputs");
    assert.equal(format?.strict, true, "Responses request should request strict JSON schema output");
    assert.equal(format?.name, "guided_legal_extraction");
    assert.ok(format?.schema, "Responses request should include a JSON schema");
  } finally {
    restoreEnv(env);
  }
}

async function verifyFailureFallbacks(): Promise<void> {
  const env = snapshotEnv();
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_CLASSIFIER_ENABLED = "1";
    process.env.OPENAI_CLASSIFIER_MODEL = "gpt-5-nano";

    await withMockedFetch(
      (async () => jsonResponse({ error: { message: "bad key" } }, 401)) as typeof fetch,
      async () => {
        const result = await runGuidedExtractionAgent({
          searchableText: "테스트",
          contextType: "messenger",
          signalHints: {}
        });

        assert.equal(result.mode, "rule_fallback");
        assert.equal(result.model, "gpt-5-nano");
        assert.match(String(result.warning), /bad key/);
      }
    );

    await withMockedFetch(
      (async () => jsonResponse({ output_text: "not json" })) as typeof fetch,
      async () => {
        const result = await runGuidedExtractionAgent({
          searchableText: "테스트",
          contextType: "messenger",
          signalHints: {}
        });

        assert.equal(result.mode, "rule_fallback");
        assert.match(String(result.warning), /did not return JSON/);
      }
    );
  } finally {
    restoreEnv(env);
  }
}

async function main(): Promise<void> {
  await verifyDisabledWithoutApiKey();
  await verifyStructuredResponseRequestAndSuccess();
  await verifyFailureFallbacks();
  process.stdout.write("Guided extraction agent checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
