export function normalizeEvidenceText(value: unknown): string;
export function uniqueEvidenceValues<T>(values: T[]): T[];
export function includesEvidenceQueries(text: string, queries: string[]): string[];
export function limitEvidenceText(value: unknown, maxLength?: number): string;
export function clampEvidenceScore(value: number): number;
export function buildEvidenceStrengthFromScores(
  topLawScore: number,
  topPrecedentScore: number
): "high" | "medium" | "low";
