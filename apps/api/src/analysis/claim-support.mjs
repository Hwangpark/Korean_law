function buildClaimSupportEntry({ claim_type, claim_path, title, grounding, citationMap }) {
  const citations = Array.isArray(citationMap?.citations) ? citationMap.citations : [];
  const statementHits = citations.filter((citation) => citation?.statement_path === claim_path);
  const hasStatementCitation = statementHits.length > 0;
  const precedentCount = Array.isArray(grounding?.precedent_reference_ids)
    ? grounding.precedent_reference_ids.length
    : 0;
  const evidenceCount = Number(grounding?.evidence_count ?? 0);
  const hasEvidence = evidenceCount > 0 || Boolean(grounding?.citation_id) || precedentCount > 0;
  const supportLevel = hasStatementCitation
    ? "direct"
    : hasEvidence
      ? "partial"
      : "missing";

  return {
    claim_type,
    claim_path,
    title,
    support_level: supportLevel,
    citation_ids: statementHits.map((citation) => citation.citation_id).filter(Boolean),
    reference_ids: [
      grounding?.law_reference_id,
      grounding?.reference_id,
      grounding?.reference_key,
      ...(Array.isArray(grounding?.precedent_reference_ids) ? grounding.precedent_reference_ids : [])
    ].filter(Boolean),
    evidence_count: evidenceCount,
    precedent_count: precedentCount,
    has_snippet: Boolean(grounding?.snippet?.text),
    match_reason: grounding?.match_reason ?? ""
  };
}

export function buildClaimSupport({ summary, charges, citationMap }) {
  const entries = (Array.isArray(charges) ? charges : []).map((charge, index) => buildClaimSupportEntry({
    claim_type: index === 0 && summary ? "summary" : "charge",
    claim_path: index === 0 && summary ? "legal_analysis.summary" : `legal_analysis.charges[${index}]`,
    title: index === 0 && summary ? summary : charge.charge,
    grounding: charge.grounding,
    citationMap
  }));

  const counts = entries.reduce((accumulator, entry) => {
    if (entry.support_level === "direct") accumulator.direct += 1;
    else if (entry.support_level === "partial") accumulator.partial += 1;
    else accumulator.missing += 1;
    return accumulator;
  }, { direct: 0, partial: 0, missing: 0 });

  return {
    overall: counts.missing > 0 ? "missing" : counts.partial > 0 ? "partial" : counts.direct > 0 ? "direct" : "missing",
    direct_count: counts.direct,
    partial_count: counts.partial,
    missing_count: counts.missing,
    entries
  };
}
