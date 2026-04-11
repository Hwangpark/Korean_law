import { createRequire } from "node:module";

import { loadJson } from "../lib/load-json.mjs";
import { fromRepo } from "../lib/paths.mjs";

const require = createRequire(import.meta.url);

function splitTextToUtterances(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/:\s*/, 2);
      if (parts.length === 2) {
        return {
          speaker: parts[0] || `Speaker${index + 1}`,
          text: parts[1],
          timestamp: null
        };
      }

      return {
        speaker: String.fromCharCode(65 + (index % 26)),
        text: line,
        timestamp: null
      };
    });
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
      return loadJson(fromRepo(request.ocr_fixture));
    }

    const ocrText = request.image_base64
      ? await recognizeImageFromBase64(String(request.image_base64))
      : "";
    const rawText = [ocrText, String(request.text ?? "").trim()].filter(Boolean).join("\n\n");

    return {
      source_type: request.context_type ?? "unknown",
      utterances: splitTextToUtterances(rawText),
      raw_text: rawText,
      note: ocrText
        ? "tesseract.js 기반 OCR 결과를 사용했습니다."
        : "이미지 OCR 결과가 비어 있어 사용자가 남긴 메모만 분석합니다."
    };
  }

  const rawText = (request.text ?? "").trim();

  return {
    source_type: request.context_type ?? "unknown",
    utterances: splitTextToUtterances(rawText),
    raw_text: rawText
  };
}
