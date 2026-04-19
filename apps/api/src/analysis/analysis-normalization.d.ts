export function getNormalizedIssueTypes(classificationResult: unknown): string[];
export function getIssueHypothesisConfidenceMap(classificationResult: unknown): Map<string, number>;
export function getNormalizedLegalElements(classificationResult: unknown, issueType: string): Record<string, unknown>;
export function resolveAnalysisScopeFlags(
  classificationResult: unknown,
  retrievalPlan: unknown
): {
  proceduralHeavy: boolean;
  insufficientFacts: boolean;
  unsupportedIssuePresent: boolean;
};
export function buildAnalysisWarnings(scopeFlags: {
  proceduralHeavy: boolean;
  insufficientFacts: boolean;
  unsupportedIssuePresent: boolean;
}): string[];
export function resolveAnalysisScopeSnapshot(
  classificationResult: unknown,
  retrievalPlan: unknown
): {
  scopeFlags: {
    proceduralHeavy: boolean;
    insufficientFacts: boolean;
    unsupportedIssuePresent: boolean;
  };
  supportedIssues: string[];
  unsupportedIssues: string[];
  scopeWarnings: string[];
};
