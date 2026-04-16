export function normalizeEvidenceText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function uniqueEvidenceValues(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

export function includesEvidenceQueries(text, queries) {
  return uniqueEvidenceValues(
    (queries ?? []).filter((query) => {
      const normalizedQuery = normalizeEvidenceText(query);
      return normalizedQuery.length > 0 && text.includes(normalizedQuery);
    })
  );
}

export function limitEvidenceText(value, maxLength = 220) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function clampEvidenceScore(value) {
  return Math.max(0.05, Math.min(0.99, Number(value.toFixed(2))));
}

export function buildEvidenceStrengthFromScores(topLawScore, topPrecedentScore) {
  if (topLawScore >= 0.7 && topPrecedentScore >= 0.55) {
    return "high";
  }
  if (topLawScore >= 0.45 || topPrecedentScore >= 0.45) {
    return "medium";
  }
  return "low";
}
