import {
  SUPPORTED_ISSUE_TYPES,
  PROCEDURAL_KEYWORDS,
  UNSUPPORTED_ISSUE_KEYWORDS,
  normalizeText
} from "./issue-catalog.mjs";
import { collapseForMatch, matchesKeywordText } from "./abuse-patterns.mjs";

const EXPLICIT_INSULT_TERMS = ["병신", "쓰레기", "개새끼", "미친", "븅신", "정신병자", "좆", "패드립"];

const FAMILY_REFERENCE_PATTERN =
  /(?:^|[^0-9a-z가-힣])(?:너|니|네|느그|너거|너네|니네)\s*(?:엄마|어머니|애미|애비|아빠|아버지|부모|가족)(?:[^0-9a-z가-힣]|$)/u;

const COMPRESSED_FAMILY_INSULT_PATTERN =
  /(?:^|[^0-9a-z가-힣])(?:느금|느그|니|네|너거|너네|니네|너검|니앰)(?:[\s._·ㆍ-]*)(?:엄마|어머니|애미|애비|아빠|아버지|부모|가족|앰|맘|마|매)(?:[^0-9a-z가-힣]|$)/u;

function hasAny(text, terms) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function toNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringArray(value) {
  return Array.isArray(value)
    ? unique(value.map((item) => String(item ?? "").trim()).filter(Boolean)).slice(0, 12)
    : [];
}

function normalizeUnsupportedIssueTypes(issueHypotheses) {
  if (!Array.isArray(issueHypotheses)) {
    return [];
  }

  return unique(
    issueHypotheses
      .map((hypothesis) => String(hypothesis?.type ?? "").trim())
      .filter((type) => type && !SUPPORTED_ISSUE_TYPES.includes(type))
  ).slice(0, 12);
}

function toConfidence(value) {
  const number = toNumber(value, 0);
  if (number <= 0) return 0;
  if (number >= 1) return 1;
  return Number(number.toFixed(2));
}

function detectFamilyDirectedInsult(text) {
  const normalizedText = normalizeText(text);
  const collapsedText = collapseForMatch(text);
  return matchesKeywordText(text, "패드립") ||
    FAMILY_REFERENCE_PATTERN.test(normalizedText) ||
    COMPRESSED_FAMILY_INSULT_PATTERN.test(collapsedText);
}

function detectSlangOrObfuscatedInsult(text) {
  const normalizedText = normalizeText(text);
  return EXPLICIT_INSULT_TERMS.some((term) => matchesKeywordText(text, term)) ||
    /(?:^|[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ])(?:ㅂㅅ|ㅄ|ㅅㅂ)(?:[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]|$)/u.test(normalizedText);
}

function countUtterances(ocrResult) {
  return Array.isArray(ocrResult?.utterances) ? ocrResult.utterances.length : 0;
}

function detectContextType(ocrResult, fallbackContextType = "other") {
  const sourceType = String(ocrResult?.source_type ?? "").trim();
  if (sourceType === "community" || sourceType === "game_chat" || sourceType === "messenger") {
    return sourceType;
  }
  return fallbackContextType;
}

export function buildClassifierFacts(ocrResult, searchableText, contextType = "other") {
  const normalizedText = normalizeText(searchableText);
  const resolvedContextType = detectContextType(ocrResult, contextType);
  const explicitInsultSignal = hasAny(normalizedText, EXPLICIT_INSULT_TERMS);
  const familyDirectedInsult = detectFamilyDirectedInsult(searchableText);
  const slangOrObfuscatedExpression = detectSlangOrObfuscatedInsult(searchableText);
  const insultingExpression = explicitInsultSignal || familyDirectedInsult || slangOrObfuscatedExpression;
  const moneyRequestSignal = hasAny(normalizedText, [
    "돈 안 주면",
    "입금",
    "송금",
    "보내면",
    "돈 보내",
    "돈 요구",
    "합의금",
    "계좌",
    "수수료",
    "대금",
    "결제"
  ]);

  return {
    source_type: String(ocrResult?.source_type ?? "").trim() || "text",
    context_type: resolvedContextType,
    utterance_count: countUtterances(ocrResult),
    text_length: normalizedText.length,
    public_exposure: hasAny(normalizedText, ["게시", "공개", "커뮤니티", "방송", "오픈채팅", "sns", "단체방"]),
    direct_message: resolvedContextType === "messenger" || hasAny(normalizedText, ["1:1", "개인톡", "dm", "다이렉트"]),
    repeated_contact: hasAny(normalizedText, ["계속", "반복", "지속", "여러 번", "매일", "계속 연락", "반복 연락"]),
    threat_signal: hasAny(normalizedText, ["죽이", "죽인", "죽여", "죽여버리", "가만 안 둬", "해코지", "찾아가", "다치게"]),
    money_request: moneyRequestSignal,
    personal_info_exposed: hasAny(normalizedText, ["전화번호", "주소", "실명", "주민번호", "학교", "회사", "사진", "계좌", "영상"]),
    insulting_expression: insultingExpression,
    family_directed_insult: familyDirectedInsult,
    slang_or_obfuscated_expression: slangOrObfuscatedExpression,
    abusive_expression_types: unique([
      explicitInsultSignal ? "direct_insult" : "",
      familyDirectedInsult ? "family_directed_insult" : "",
      slangOrObfuscatedExpression ? "slang_or_obfuscated" : ""
    ]),
    false_fact_signal: hasAny(normalizedText, ["허위", "거짓", "조작", "위조", "없는 사실"]),
    target_identifiable: hasAny(normalizedText, ["실명", "전화번호", "주소", "학교", "회사", "학번", "닉네임", "프로필"]),
    procedural_signal: hasAny(normalizedText, PROCEDURAL_KEYWORDS),
    unsupported_issue_signal: hasAny(normalizedText, UNSUPPORTED_ISSUE_KEYWORDS),
    detected_keywords: unique([
      hasAny(normalizedText, ["허위", "거짓", "조작"]) ? "허위/거짓" : "",
      hasAny(normalizedText, ["죽이", "죽인", "죽여", "해코지", "찾아가"]) ? "해악 고지" : "",
      hasAny(normalizedText, ["전화번호", "주소", "실명", "영상"]) ? "개인정보 노출" : "",
      moneyRequestSignal ? "금전 요구" : "",
      hasAny(normalizedText, ["게시", "공개", "커뮤니티", "sns"]) ? "공개 전파" : "",
      hasAny(normalizedText, ["계속", "반복", "지속"]) ? "반복성" : "",
      insultingExpression ? "경멸적 표현" : "",
      familyDirectedInsult ? "가족비하 표현" : ""
    ]),
    semantic_signals: unique([
      insultingExpression ? "insulting_expression" : "",
      familyDirectedInsult ? "family_directed_insult" : "",
      slangOrObfuscatedExpression ? "slang_or_obfuscated_expression" : "",
      moneyRequestSignal ? "money_request" : "",
      hasAny(normalizedText, ["허위", "거짓", "조작"]) ? "false_fact_signal" : "",
      hasAny(normalizedText, ["게시", "공개", "커뮤니티", "sns"]) ? "public_exposure" : "",
      hasAny(normalizedText, ["계속", "반복", "지속"]) ? "repeated_contact" : ""
    ])
  };
}

export function normalizeGuidedClassifierExtraction(rawExtraction, fallbackFacts, contextType = "other") {
  const raw = rawExtraction && typeof rawExtraction === "object" ? rawExtraction : {};
  const rawFacts = raw.facts && typeof raw.facts === "object" ? raw.facts : {};
  const fallback = fallbackFacts && typeof fallbackFacts === "object" ? fallbackFacts : {};
  const unsupportedIssueTypes = normalizeUnsupportedIssueTypes(raw.issue_hypotheses);
  const factKeys = [
    "public_exposure",
    "direct_message",
    "repeated_contact",
    "threat_signal",
    "money_request",
    "personal_info_exposed",
    "insulting_expression",
    "family_directed_insult",
    "slang_or_obfuscated_expression",
    "false_fact_signal",
    "target_identifiable",
    "procedural_signal",
    "unsupported_issue_signal"
  ];
  const facts = {
    source_type: String(fallback.source_type ?? "text").trim() || "text",
    context_type: String(fallback.context_type ?? contextType).trim() || contextType,
    utterance_count: toNumber(fallback.utterance_count, 0),
    text_length: toNumber(fallback.text_length, 0)
  };

  for (const key of factKeys) {
    facts[key] = toBoolean(rawFacts[key], toBoolean(fallback[key], false));
  }
  if (unsupportedIssueTypes.length > 0) {
    facts.unsupported_issue_signal = true;
  }

  facts.abusive_expression_types = toStringArray(rawFacts.abusive_expression_types ?? fallback.abusive_expression_types);
  facts.detected_keywords = toStringArray(rawFacts.detected_keywords ?? fallback.detected_keywords);
  facts.semantic_signals = toStringArray(rawFacts.semantic_signals ?? fallback.semantic_signals);

  const issueHypotheses = Array.isArray(raw.issue_hypotheses)
    ? raw.issue_hypotheses
      .map((hypothesis) => {
        const type = String(hypothesis?.type ?? "").trim();
        if (!SUPPORTED_ISSUE_TYPES.includes(type)) {
          return null;
        }

        const confidence = toConfidence(hypothesis?.confidence);
        if (confidence <= 0) {
          return null;
        }

        return {
          type,
          confidence,
          matched_terms: toStringArray(hypothesis?.matched_terms),
          supported: true,
          source: "llm",
          sources: ["llm"],
          reason: String(hypothesis?.reason ?? "").trim() || "LLM guided extraction에서 도출된 검색 가설입니다."
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.confidence - left.confidence)
    : [];

  const rawLegalElements = raw.legal_elements && typeof raw.legal_elements === "object" ? raw.legal_elements : {};
  const legalElements = {};

  if (Array.isArray(rawLegalElements)) {
    for (const entry of rawLegalElements) {
      const issueType = String(entry?.issue_type ?? "").trim();
      if (!SUPPORTED_ISSUE_TYPES.includes(issueType)) {
        continue;
      }

      const elementSignals = toStringArray(entry?.element_signals);
      if (elementSignals.length === 0) {
        continue;
      }

      legalElements[issueType] = {
        ...(legalElements[issueType] ?? {}),
        ...Object.fromEntries(elementSignals.map((signal) => [signal, true]))
      };
    }
  } else {
    for (const issueType of SUPPORTED_ISSUE_TYPES) {
      const rawIssueElements = rawLegalElements[issueType];
      if (!rawIssueElements || typeof rawIssueElements !== "object" || Array.isArray(rawIssueElements)) {
        continue;
      }

      legalElements[issueType] = Object.fromEntries(
        Object.entries(rawIssueElements)
          .filter(([, value]) => typeof value === "boolean")
          .map(([key, value]) => [key, value])
      );
    }
  }

  const rawHints = raw.query_hints && typeof raw.query_hints === "object" ? raw.query_hints : {};
  const queryHints = {
    broad: toStringArray(rawHints.broad),
    precise: toStringArray(rawHints.precise),
    law: {
      broad: toStringArray(rawHints.law?.broad),
      precise: toStringArray(rawHints.law?.precise)
    },
    precedent: {
      broad: toStringArray(rawHints.precedent?.broad),
      precise: toStringArray(rawHints.precedent?.precise)
    }
  };

  const warnings = unique([
    ...toStringArray(raw.warnings),
    unsupportedIssueTypes.length > 0 ? `지원 범위 밖 이슈 후보: ${unsupportedIssueTypes.join(", ")}` : ""
  ]);

  return {
    facts,
    issue_hypotheses: issueHypotheses,
    legal_elements: legalElements,
    query_hints: queryHints,
    warnings,
    unsupported_issue_types: unsupportedIssueTypes
  };
}
