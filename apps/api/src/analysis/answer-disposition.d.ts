export type AnswerDisposition =
  | "direct_answer"
  | "limited_answer"
  | "handoff_recommended"
  | "safety_first_handoff";

export function sanitizeAnswerDisposition(value: unknown): AnswerDisposition;

export function buildAnswerDisposition(input?: {
  handoffRecommended?: boolean;
  abstainReasons?: unknown;
  uncertaintyReasons?: unknown;
  verifierStatus?: string;
  highRiskTriggered?: boolean;
  highRiskEmergency?: boolean;
  blockedReasons?: unknown;
}): AnswerDisposition;
