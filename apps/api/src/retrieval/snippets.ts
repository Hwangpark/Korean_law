import type { EvidenceQueryRef, EvidenceSnippet } from "./types.js";
import {
  includesEvidenceQueries,
  limitEvidenceText,
  normalizeEvidenceText,
  uniqueEvidenceValues
} from "../analysis/evidence-shared.mjs";

interface SnippetSourceInput {
  field: EvidenceSnippet["field"];
  text: string;
}

interface SnippetCandidate extends SnippetSourceInput {
  normalized: string;
}

interface SelectBestEvidenceSnippetInput {
  sources: SnippetSourceInput[];
  matchedQueries?: EvidenceQueryRef[];
  issueTypes?: string[];
  maxLength?: number;
}

const SENTENCE_SPLIT_PATTERN = /(?<=[.!?。！？…])\s+|[\r\n]+/u;

function normalizeSnippetText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function splitSnippetSegments(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_PATTERN)
    .map((segment) => normalizeSnippetText(segment))
    .filter(Boolean);
}

function buildSnippetCandidates(source: SnippetSourceInput): SnippetCandidate[] {
  const normalizedSource = normalizeSnippetText(source.text);
  if (!normalizedSource) {
    return [];
  }

  const segments = splitSnippetSegments(normalizedSource);
  const baseSegments = segments.length > 0 ? segments : [normalizedSource];
  const candidates = new Map<string, SnippetCandidate>();

  const pushCandidate = (text: string) => {
    const cleaned = normalizeSnippetText(text);
    if (!cleaned) {
      return;
    }

    const normalized = normalizeEvidenceText(cleaned);
    if (!normalized) {
      return;
    }

    candidates.set(`${source.field}:${normalized}`, {
      field: source.field,
      text: cleaned,
      normalized
    });
  };

  for (let index = 0; index < baseSegments.length; index += 1) {
    pushCandidate(baseSegments[index]);
    if (index < baseSegments.length - 1) {
      pushCandidate(`${baseSegments[index]} ${baseSegments[index + 1]}`);
    }
  }

  pushCandidate(normalizedSource);
  return [...candidates.values()];
}

function scoreSnippetCandidate(
  candidate: SnippetCandidate,
  matchedQueries: EvidenceQueryRef[],
  issueTypes: string[]
): number {
  const preciseQueries = matchedQueries
    .filter((query) => query.bucket === "precise")
    .map((query) => query.text);
  const broadQueries = matchedQueries
    .filter((query) => query.bucket === "broad")
    .map((query) => query.text);
  const preciseMatches = includesEvidenceQueries(candidate.normalized, preciseQueries);
  const broadMatches = includesEvidenceQueries(candidate.normalized, broadQueries);
  const issueMatches = issueTypes.filter((issue) => candidate.normalized.includes(normalizeEvidenceText(issue)));
  const looseQueryTokenMatches = matchedQueries.filter((query) => {
    const tokens = normalizeEvidenceText(query.text)
      .split(/\s+/)
      .map((token: string) => token.trim())
      .filter((token: string) => token.length >= 2);
    if (tokens.length === 0) {
      return false;
    }

    const matchedTokenCount = tokens.filter((token: string) => candidate.normalized.includes(token)).length;
    return matchedTokenCount >= Math.min(tokens.length, 2);
  });

  const legalElementSignals = uniqueEvidenceValues(
    matchedQueries.flatMap((query) => query.legal_element_signals ?? [])
  );
  const legalElementMatches = legalElementSignals.filter((signal: string) =>
    candidate.normalized.includes(normalizeEvidenceText(signal))
  );

  let score = 0;
  score += preciseMatches.length * 5;
  score += broadMatches.length * 2;
  score += looseQueryTokenMatches.length * 2.5;
  score += issueMatches.length * 3;
  score += legalElementMatches.length * 2;

  if (candidate.text.length >= 24 && candidate.text.length <= 180) {
    score += 1.25;
  } else if (candidate.text.length <= 280) {
    score += 0.5;
  }

  if (candidate.field === "content" || candidate.field === "key_reasoning" || candidate.field === "summary") {
    score += 0.5;
  }

  return score;
}

export function selectBestEvidenceSnippet(
  input: SelectBestEvidenceSnippetInput
): EvidenceSnippet | null {
  const sources = (input.sources ?? []).filter((source) => normalizeSnippetText(source.text));
  if (sources.length === 0) {
    return null;
  }

  const matchedQueries = input.matchedQueries ?? [];
  const issueTypes = uniqueEvidenceValues(input.issueTypes ?? []);
  const candidates = sources.flatMap((source) => buildSnippetCandidates(source));

  if (candidates.length === 0) {
    const fallback = sources[0];
    return {
      field: fallback.field,
      text: limitEvidenceText(fallback.text, input.maxLength ?? 220)
    };
  }

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreSnippetCandidate(candidate, matchedQueries, issueTypes)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.candidate.text.length - right.candidate.text.length;
    });

  const best = ranked[0]?.candidate ?? candidates[0];
  if (!best) {
    return null;
  }

  return {
    field: best.field,
    text: limitEvidenceText(best.text, input.maxLength ?? 220)
  };
}
