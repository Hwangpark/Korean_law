export function buildLawReferenceKey(lawName: unknown, articleNo: unknown): string;
export function buildPrecedentReferenceKey(caseNo: unknown): string;
export function buildReferenceHref(kind: "law" | "precedent", sourceKey: string): string;
