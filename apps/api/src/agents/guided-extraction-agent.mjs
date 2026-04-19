import { normalizeGuidedClassifierExtraction } from "../lib/classification-facts.mjs";
import { SUPPORTED_ISSUE_TYPES } from "../lib/issue-catalog.mjs";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadOpenAiClassifierConfig(env = process.env) {
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const enabled = apiKey.length > 0 && String(env.OPENAI_CLASSIFIER_ENABLED ?? "1") !== "0";
  const model = String(env.OPENAI_CLASSIFIER_MODEL ?? "gpt-5-nano").trim() || "gpt-5-nano";
  const reasoningEffort = String(env.OPENAI_CLASSIFIER_REASONING_EFFORT ?? "").trim() ||
    (model.startsWith("gpt-5") ? "minimal" : "");

  return {
    enabled,
    apiKey,
    model,
    baseUrl: String(env.OPENAI_BASE_URL ?? OPENAI_RESPONSES_URL).trim() || OPENAI_RESPONSES_URL,
    timeoutMs: parseIntOr(env.OPENAI_CLASSIFIER_TIMEOUT_MS, 45_000),
    maxInputChars: parseIntOr(env.OPENAI_CLASSIFIER_MAX_INPUT_CHARS, 4_000),
    maxOutputTokens: parseIntOr(env.OPENAI_CLASSIFIER_MAX_OUTPUT_TOKENS, 900),
    reasoningEffort
  };
}

function compactJson(value) {
  return JSON.stringify(value ?? {});
}

function limitText(value, maxChars) {
  const text = String(value ?? "");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function buildSystemPrompt() {
  return [
    "너는 한국어 온라인 분쟁 텍스트를 법률 검색용 facts/elements/query hints로 추출하는 모델이다.",
    "목표는 죄명을 단정하는 것이 아니라 retrieval에 쓸 사실 신호와 구성요건 후보를 구조화하는 것이다.",
    `지원 이슈는 ${SUPPORTED_ISSUE_TYPES.join(", ")} 뿐이다.`,
    "지원 이슈 밖 죄명은 issue_hypotheses에 넣지 말고 facts.unsupported_issue_signal 또는 warnings에만 남긴다.",
    "신조어, 초성, 비꼼, 우회표현은 표면 키워드가 없어도 의미로 판단한다.",
    "존재하지 않는 죄명이나 상상한 법률명은 절대 만들지 않는다.",
    "반드시 JSON object만 출력한다."
  ].join("\n");
}

function buildStringArraySchema() {
  return {
    type: "array",
    items: { type: "string" }
  };
}

function buildReadableSystemPrompt() {
  return [
    "너는 한국어 온라인 대화/게시글을 법률 검색용 facts, legal elements, query hints로 추출하는 모델이다.",
    "목표는 최종 유무죄 판단이 아니라 retrieval에 쓸 사실 신호와 구성요건 후보를 구조화하는 것이다.",
    `지원 이슈는 이 6개뿐이다: ${SUPPORTED_ISSUE_TYPES.join(", ")}.`,
    "지원 범위 밖 죄명이나 법률명은 issue_hypotheses에 넣지 말고 facts.unsupported_issue_signal 또는 warnings에만 남겨라.",
    "존재하지 않는 죄명, 법률명, 판례명은 절대 만들지 마라.",
    "신조어, 초성, 비꼼, 우회표현은 정확한 키워드 매칭이 아니라 의미로 판단하라.",
    "예: '너거매', '느금마', '니애미'처럼 가족을 겨냥한 변형 욕설은 표현이 달라도 family_directed_insult/insulting_expression 신호로 해석할 수 있다.",
    "짧은 입력이어도 욕설/협박/금전요구처럼 명확한 표현이 있으면 해당 facts는 true로 표시하라.",
    "issue_hypotheses에는 confidence 0.3 이상인 후보만 넣고, 자신 없으면 빈 배열을 사용하라. 0점 후보를 채우지 마라.",
    "가족 비하 욕설만 보이면 보통 모욕 후보이고, 협박/공갈이나 명예훼손 후보로 억지 확장하지 마라.",
    "다만 단순한 가족 언급은 욕설로 보지 말고, 공격적/경멸적 맥락이 있을 때만 표시하라.",
    "반드시 JSON object만 출력하라."
  ].join("\n");
}

function buildQueryHintSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["broad", "precise"],
    properties: {
      broad: buildStringArraySchema(),
      precise: buildStringArraySchema()
    }
  };
}

function buildGuidedExtractionTextFormat() {
  const booleanFactProperties = {
    public_exposure: { type: "boolean", description: "공개 게시, 단체방, 커뮤니티, SNS처럼 제3자가 볼 수 있는 맥락" },
    direct_message: { type: "boolean", description: "1:1 메시지나 비공개 직접 대화 맥락" },
    repeated_contact: { type: "boolean", description: "반복 연락, 따라다님, 집/직장 주변 접근 등 지속적 접촉" },
    threat_signal: { type: "boolean", description: "해악 고지, 죽이겠다/찾아가겠다/다치게 하겠다 같은 협박 신호" },
    money_request: { type: "boolean", description: "돈, 물건, 계좌, 입금, 환불, 재산상 이익 요구" },
    personal_info_exposed: { type: "boolean", description: "전화번호, 주소, 실명, 계좌, 학교, 직장 등 개인정보 노출" },
    insulting_expression: { type: "boolean", description: "상대방 인격을 경멸/비하하는 욕설 또는 모욕 표현" },
    family_directed_insult: { type: "boolean", description: "가족을 겨냥한 변형 욕설. 예: 너거매, 느금마, 니애미, 패드립 계열" },
    slang_or_obfuscated_expression: { type: "boolean", description: "초성, 변형 철자, 은어, 우회표현, 신조어" },
    false_fact_signal: { type: "boolean", description: "허위사실, 조작, 거짓 주장, 사실 적시형 비방 신호" },
    target_identifiable: { type: "boolean", description: "피해자나 대상이 특정 가능함" },
    procedural_signal: { type: "boolean", description: "항소, 공판, 증거능력 등 절차법 중심 텍스트" },
    unsupported_issue_signal: { type: "boolean", description: "지원 6개 이슈 밖의 범죄/분쟁 신호" }
  };

  return {
    type: "json_schema",
    name: "guided_legal_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["facts", "issue_hypotheses", "legal_elements", "query_hints", "warnings"],
      properties: {
        facts: {
          type: "object",
          additionalProperties: false,
          required: [
            ...Object.keys(booleanFactProperties),
            "abusive_expression_types",
            "semantic_signals",
            "detected_keywords"
          ],
          properties: {
            ...booleanFactProperties,
            abusive_expression_types: buildStringArraySchema(),
            semantic_signals: buildStringArraySchema(),
            detected_keywords: buildStringArraySchema()
          }
        },
        issue_hypotheses: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "confidence", "matched_terms", "reason"],
            properties: {
              type: {
                type: "string",
                enum: SUPPORTED_ISSUE_TYPES
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1
              },
              matched_terms: buildStringArraySchema(),
              reason: { type: "string" }
            }
          }
        },
        legal_elements: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["issue_type", "element_signals", "reason"],
            properties: {
              issue_type: {
                type: "string",
                enum: SUPPORTED_ISSUE_TYPES
              },
              element_signals: buildStringArraySchema(),
              reason: { type: "string" }
            }
          }
        },
        query_hints: {
          type: "object",
          additionalProperties: false,
          required: ["broad", "precise", "law", "precedent"],
          properties: {
            broad: buildStringArraySchema(),
            precise: buildStringArraySchema(),
            law: buildQueryHintSchema(),
            precedent: buildQueryHintSchema()
          }
        },
        warnings: buildStringArraySchema()
      }
    }
  };
}

function buildUserPrompt({ searchableText, contextType, signalHints, maxInputChars }) {
  return compactJson({
    task: "guided_legal_extraction",
    context_type: contextType,
    raw_text: limitText(searchableText, maxInputChars),
    rule_signal_hints: signalHints,
    interpretation_rules: [
      "raw_text를 먼저 의미 단위로 해석한 뒤 facts를 채운다.",
      "너거매/느금마/니애미/패드립 계열 변형 욕설은 가족 비하 욕설 신호다.",
      "가족 비하 욕설 + 경멸 표현은 insulting_expression=true, family_directed_insult=true, slang_or_obfuscated_expression=true로 본다.",
      "단순히 짧거나 정보가 부족하다는 이유만으로 명확한 욕설 신호를 false로 낮추지 않는다.",
      "issue_hypotheses에는 confidence 0.3 이상 후보만 넣고, 0점 후보는 넣지 않는다."
    ],
    output_contract: {
      facts: {
        public_exposure: "boolean",
        direct_message: "boolean",
        repeated_contact: "boolean",
        threat_signal: "boolean",
        money_request: "boolean",
        personal_info_exposed: "boolean",
        insulting_expression: "boolean",
        family_directed_insult: "boolean",
        slang_or_obfuscated_expression: "boolean",
        false_fact_signal: "boolean",
        target_identifiable: "boolean",
        procedural_signal: "boolean",
        unsupported_issue_signal: "boolean",
        abusive_expression_types: "string[]",
        semantic_signals: "string[]",
        detected_keywords: "string[]"
      },
      issue_hypotheses: [
        {
          type: SUPPORTED_ISSUE_TYPES,
          confidence: "0..1 number",
          matched_terms: "meaning/elements, not only exact words",
          reason: "short Korean reason"
        }
      ],
      legal_elements: {
        issue_type: "supported issue type",
        element_signals: "string[] of satisfied legal element signal names",
        reason: "short Korean reason"
      },
      query_hints: {
        broad: "string[]",
        precise: "string[]",
        law: { broad: "string[]", precise: "string[]" },
        precedent: { broad: "string[]", precise: "string[]" }
      },
      warnings: "string[]"
    }
  });
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }

  if (Array.isArray(payload?.output)) {
    const texts = [];
    for (const item of payload.output) {
      for (const content of item?.content ?? []) {
        if (typeof content?.text === "string") {
          texts.push(content.text);
        }
      }
    }
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  return "";
}

function parseJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("OpenAI classifier returned an empty response.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/u);
    if (!match) {
      throw new Error("OpenAI classifier did not return JSON.");
    }
    return JSON.parse(match[0]);
  }
}

async function postOpenAiResponses({ config, searchableText, contextType, signalHints }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const requestBody = {
      model: config.model,
      input: [
        { role: "system", content: buildReadableSystemPrompt() },
        {
          role: "user",
          content: buildUserPrompt({
            searchableText,
            contextType,
            signalHints,
            maxInputChars: config.maxInputChars
          })
        }
      ],
      text: {
        format: buildGuidedExtractionTextFormat()
      },
      max_output_tokens: config.maxOutputTokens
    };

    if (config.reasoningEffort) {
      requestBody.reasoning = { effort: config.reasoningEffort };
    }

    const response = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI classifier failed with ${response.status}.`;
      throw new Error(message);
    }

    return parseJsonObject(extractResponseText(payload));
  } finally {
    clearTimeout(timeout);
  }
}

export async function runGuidedExtractionAgent({ searchableText, contextType, signalHints }) {
  const config = loadOpenAiClassifierConfig();
  if (!config.enabled) {
    return {
      mode: "rule_fallback",
      model: null,
      extraction: null,
      warning: "OPENAI_API_KEY is not set; classifier used rule fallback."
    };
  }

  try {
    const rawExtraction = await postOpenAiResponses({
      config,
      searchableText,
      contextType,
      signalHints
    });

    return {
      mode: "openai",
      model: config.model,
      extraction: normalizeGuidedClassifierExtraction(rawExtraction, signalHints, contextType),
      warning: null
    };
  } catch (error) {
    return {
      mode: "rule_fallback",
      model: config.model,
      extraction: null,
      warning: `OpenAI classifier fallback: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
