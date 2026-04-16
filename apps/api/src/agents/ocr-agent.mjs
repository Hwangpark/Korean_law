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
        raw_text: buildMaskedRawText(utterances)
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
    raw_text: buildMaskedRawText(utterances)
  };
}
