export async function runReportGenerationAgent(legalAnalysisResult, precedentSearchResult) {
  const summary =
    legalAnalysisResult.charges.length === 0
      ? "현재 fixture 기준으로 명확한 법적 쟁점이 충분히 식별되지 않았습니다."
      : `현재 입력에서는 ${legalAnalysisResult.charges.length}건의 주요 법적 쟁점이 탐지되었습니다.`;

  return {
    risk_level: legalAnalysisResult.risk_level,
    summary,
    issue_cards: legalAnalysisResult.charges.map((charge) => ({
      title: charge.charge,
      basis: charge.basis,
      probability: charge.probability,
      expected_penalty: charge.expected_penalty,
      checklist: charge.elements_met
    })),
    precedent_cards: precedentSearchResult.precedents.map((precedent) => ({
      case_no: precedent.case_no,
      court: precedent.court,
      verdict: precedent.verdict,
      summary: precedent.summary,
      similarity_score: precedent.similarity_score
    })),
    next_steps: legalAnalysisResult.recommended_actions,
    evidence_to_collect: legalAnalysisResult.evidence_to_collect,
    disclaimer: legalAnalysisResult.disclaimer,
    share_text: `${summary} 자세한 검토 전까지는 원본 증거 보존과 플랫폼 신고 이력을 함께 정리하는 것이 좋습니다.`
  };
}
