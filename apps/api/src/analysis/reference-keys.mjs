function normalizeReferencePart(value) {
  return String(value ?? "").trim();
}

export function buildLawReferenceKey(lawName, articleNo) {
  return `law:${normalizeReferencePart(lawName)}:${normalizeReferencePart(articleNo)}`;
}

export function buildPrecedentReferenceKey(caseNo) {
  return `precedent:${normalizeReferencePart(caseNo)}`;
}

export function buildReferenceHref(kind, sourceKey) {
  return `/api/references/${kind}/${encodeURIComponent(sourceKey)}`;
}
