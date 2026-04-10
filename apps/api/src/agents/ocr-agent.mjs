import { loadJson } from "../lib/load-json.mjs";
import { fromRepo } from "../lib/paths.mjs";

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

export async function runOcrAgent(request) {
  if (request.input_type === "image") {
    if (request.ocr_fixture) {
      return loadJson(fromRepo(request.ocr_fixture));
    }

    return {
      source_type: request.context_type ?? "unknown",
      utterances: [],
      raw_text: "",
      note: "OCR API 키가 없어 fixture 기반 OCR만 지원합니다."
    };
  }

  const rawText = (request.text ?? "").trim();

  return {
    source_type: request.context_type ?? "unknown",
    utterances: splitTextToUtterances(rawText),
    raw_text: rawText
  };
}
