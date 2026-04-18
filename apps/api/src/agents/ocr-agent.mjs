import { createRequire } from "node:module";

import { loadJson } from "../lib/load-json.mjs";
import { fromRepo } from "../lib/paths.mjs";
import { createSpeakerAlias, maskPersonalInfoText } from "../analysis/privacy.js";

const require = createRequire(import.meta.url);

function splitTextToUtterances(text) {
  const speakerAliases = new Map();

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/:\s*/, 2);
      if (parts.length === 2) {
        const originalSpeaker = parts[0] || `Speaker${index + 1}`;
        if (!speakerAliases.has(originalSpeaker)) {
          speakerAliases.set(originalSpeaker, createSpeakerAlias(speakerAliases.size));
        }

        return {
          speaker: speakerAliases.get(originalSpeaker),
          text: maskPersonalInfoText(parts[1]),
          timestamp: null
        };
      }

      return {
        speaker: createSpeakerAlias(index),
        text: maskPersonalInfoText(line),
        timestamp: null
      };
    });
}

function sanitizeStructuredUtterances(utterances = []) {
  const speakerAliases = new Map();

  return utterances.map((item, index) => {
    const originalSpeaker = String(item?.speaker ?? `Speaker${index + 1}`).trim() || `Speaker${index + 1}`;
    if (!speakerAliases.has(originalSpeaker)) {
      speakerAliases.set(originalSpeaker, createSpeakerAlias(speakerAliases.size));
    }

    return {
      speaker: speakerAliases.get(originalSpeaker),
      text: maskPersonalInfoText(item?.text ?? ""),
      timestamp: item?.timestamp ?? null
    };
  });
}

function buildMaskedRawText(utterances) {
  return utterances
    .map((utterance) => `${utterance.speaker}: ${utterance.text}`.trim())
    .join("\n");
}

function buildOcrReview({ sourceType = "unknown", utterances = [], rawText = "", note = null, inputType = "text" }) {
  const reasons = [];
  const normalizedText = String(rawText ?? "").trim();
  const utteranceCount = Array.isArray(utterances) ? utterances.length : 0;
  const alphaNumericLength = (normalizedText.match(/[0-9A-Za-z가-힣]/g) ?? []).length;
  const averageUtteranceLength = utteranceCount > 0
    ? utterances.reduce((sum, item) => sum + String(item?.text ?? "").trim().length, 0) / utteranceCount
    : 0;

  let status = inputType === "image" ? "ok" : "not_needed";
  let confidenceScore = inputType === "image" ? 0.78 : 1;

  if (!normalizedText || utteranceCount === 0) {
    status = "uncertain";
    confidenceScore = inputType === "image" ? 0.18 : 0.4;
    reasons.push("추출된 대화가 거의 없어서 원문 확인이 필요합니다.");
  } else {
    if (inputType === "image" && alphaNumericLength < 24) {
      status = "review";
      confidenceScore = Math.min(confidenceScore, 0.44);
      reasons.push("추출 텍스트가 짧아서 원문 확인이 필요합니다.");
    }

    if (inputType === "image" && averageUtteranceLength < 8) {
      status = status === "uncertain" ? status : "review";
      confidenceScore = Math.min(confidenceScore, 0.58);
      reasons.push("대화 조각이 짧아 발화 분리나 문맥 해석이 흔들릴 수 있습니다.");
    }

    if (normalizedText.includes("�")) {
      status = "review";
      confidenceScore = Math.min(confidenceScore, 0.35);
      reasons.push("문자 깨짐 흔적이 있어 원문 이미지 대조가 필요합니다.");
    }
  }

  if (note && inputType === "image" && /비어 있어/.test(String(note))) {
    status = "uncertain";
    confidenceScore = Math.min(confidenceScore, 0.12);
    reasons.push("OCR 결과가 비어 있어 첨부 메모 위주로만 분석했습니다.");
  }

  if (sourceType === "messenger" && utteranceCount < 2 && inputType === "image") {
    status = status === "uncertain" ? status : "review";
    confidenceScore = Math.min(confidenceScore, 0.62);
    reasons.push("메신저 캡처치고 발화 수가 적어 일부 줄이 누락됐을 수 있습니다.");
  }

  return {
    status,
    confidence_score: Number(confidenceScore.toFixed(2)),
    requires_human_review: status === "review" || status === "uncertain",
    reasons,
    recommended_action:
      status === "ok" || status === "not_needed"
        ? null
        : "원문 이미지와 추출 텍스트를 함께 확인해 주세요."
  };
}

async function recognizeImageFromBase64(base64) {
  const Tesseract = require("tesseract.js");
  const buffer = Buffer.from(base64, "base64");
  const result = await Tesseract.recognize(buffer, "kor+eng", {
    logger: () => {}
  });
  return String(result?.data?.text ?? "").trim();
}

export async function runOcrAgent(request) {
  if (request.input_type === "image") {
    if (request.ocr_fixture) {
      const fixture = await loadJson(fromRepo(request.ocr_fixture));
      const utterances = Array.isArray(fixture.utterances)
        ? sanitizeStructuredUtterances(fixture.utterances)
        : splitTextToUtterances(String(fixture.raw_text ?? ""));
      return {
        source_type: fixture.source_type ?? request.context_type ?? "unknown",
        utterances,
        raw_text: buildMaskedRawText(utterances),
        review: buildOcrReview({
          sourceType: fixture.source_type ?? request.context_type ?? "unknown",
          utterances,
          rawText: buildMaskedRawText(utterances),
          inputType: "image"
        })
      };
    }

    const ocrText = request.image_base64
      ? await recognizeImageFromBase64(String(request.image_base64))
      : "";
    const normalizedText = [ocrText, String(request.text ?? "").trim()].filter(Boolean).join("\n\n");
    const utterances = splitTextToUtterances(normalizedText);

    return {
      source_type: request.context_type ?? "unknown",
      utterances,
      raw_text: buildMaskedRawText(utterances),
      review: buildOcrReview({
        sourceType: request.context_type ?? "unknown",
        utterances,
        rawText: buildMaskedRawText(utterances),
        note: ocrText
          ? "tesseract.js 기반 OCR 결과를 사용했습니다."
          : "이미지 OCR 결과가 비어 있어 사용자가 남긴 메모만 분석합니다.",
        inputType: "image"
      }),
      note: ocrText
        ? "tesseract.js 기반 OCR 결과를 사용했습니다."
        : "이미지 OCR 결과가 비어 있어 사용자가 남긴 메모만 분석합니다."
    };
  }

  const rawText = (request.text ?? "").trim();
  const utterances = splitTextToUtterances(rawText);

  return {
    source_type: request.context_type ?? "unknown",
    utterances,
    raw_text: buildMaskedRawText(utterances),
    review: buildOcrReview({
      sourceType: request.context_type ?? "unknown",
      utterances,
      rawText: buildMaskedRawText(utterances),
      inputType: "text"
    })
  };
}
