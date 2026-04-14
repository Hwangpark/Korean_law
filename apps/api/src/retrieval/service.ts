import { buildReferenceSeeds, type ReferenceLibraryItem } from "../analysis/references.js";
import type { AnalysisStore } from "../analysis/store.js";
import { createRetrievalAdapter } from "./mcp-adapter.js";
import { buildKeywordQueryPlan } from "./planner.js";
import type {
  KeywordVerificationRequest,
  KeywordVerificationResponse,
  LawDocumentRecord,
  PrecedentDocumentRecord,
  VerificationActor
} from "./types.js";
import type { KeywordVerificationStore } from "./store.js";
import {
  buildLawVerificationCards,
  buildPrecedentVerificationCards,
  buildVerificationHeadline,
  buildVerificationInterpretation
} from "./verification.js";

export interface KeywordVerificationService {
  verifyKeyword(
    request: KeywordVerificationRequest,
    actor?: VerificationActor
  ): Promise<KeywordVerificationResponse>;
}

interface KeywordVerificationServiceDeps {
  providerMode: string;
  analysisStore: AnalysisStore;
  keywordStore: KeywordVerificationStore;
}

function severityToRiskLevel(severity: "low" | "medium" | "high" | undefined): number {
  switch (severity) {
    case "high":
      return 5;
    case "medium":
      return 3;
    default:
      return 1;
  }
}

function buildPseudoAnalysisResult(
  laws: LawDocumentRecord[],
  precedents: PrecedentDocumentRecord[]
): Record<string, unknown> {
  return {
    law_search: {
      laws
    },
    precedent_search: {
      precedents
    }
  };
}

function buildReferenceMap(items: ReferenceLibraryItem[]): Map<string, ReferenceLibraryItem> {
  return new Map(items.map((item) => [item.id, item]));
}

export function createKeywordVerificationService(
  deps: KeywordVerificationServiceDeps
): KeywordVerificationService {
  const adapter = createRetrievalAdapter(deps.providerMode);

  return {
    async verifyKeyword(request, actor = {}) {
      const plan = buildKeywordQueryPlan(request.query, request.contextType);
      const limit = Math.max(1, Math.min(request.limit ?? 4, 6));

      const [laws, precedents] = await Promise.all([
        adapter.searchLaws(plan, limit),
        adapter.searchPrecedents(plan, limit)
      ]);

      const pseudoResult = buildPseudoAnalysisResult(laws, precedents);
      const referenceSeeds = buildReferenceSeeds(pseudoResult, deps.providerMode);
      const referenceLibrary = await deps.analysisStore.saveReferenceLibrary({
        providerMode: deps.providerMode,
        result: pseudoResult,
        caseId: null,
        runId: null
      });
      const referencesByKey = buildReferenceMap(referenceLibrary);

      const matchedLaws = buildLawVerificationCards(plan, laws, referencesByKey).slice(0, limit);
      const matchedPrecedents = buildPrecedentVerificationCards(plan, precedents, referencesByKey).slice(0, limit);
      const allReferences = referenceSeeds
        .map((seed) => referencesByKey.get(seed.sourceKey))
        .filter((item): item is ReferenceLibraryItem => Boolean(item));
      const disclaimer = "본 결과는 참고용 법률 정보이며, 실제 고소 가능성은 전체 대화와 증거를 기준으로 별도 검토가 필요합니다.";
      const topSeverity = plan.candidateIssues[0]?.severity;
      const riskLevel = severityToRiskLevel(topSeverity);
      const summary = buildVerificationHeadline(plan, matchedLaws.length + matchedPrecedents.length);
      const interpretation = buildVerificationInterpretation(plan, matchedLaws.length + matchedPrecedents.length);

      const responseWithoutId: Omit<KeywordVerificationResponse, "run_id"> = {
        query: {
          original: plan.originalQuery,
          normalized: plan.normalizedQuery,
          context_type: plan.contextType
        },
        plan: {
          tokens: plan.tokens,
          candidate_issues: plan.candidateIssues,
          law_queries: plan.lawQueries,
          precedent_queries: plan.precedentQueries,
          warnings: plan.warnings
        },
        verification: {
          headline: summary,
          interpretation,
          warnings: plan.warnings,
          disclaimer
        },
        matched_laws: matchedLaws,
        matched_precedents: matchedPrecedents,
        legal_analysis: {
          can_sue: matchedLaws.length + matchedPrecedents.length > 0,
          risk_level: riskLevel,
          summary,
          charges: matchedLaws.map((item) => ({
            charge: item.title,
            basis: item.matchReason,
            elements_met: [item.summary, item.reference.details].filter(Boolean),
            probability: item.confidenceScore >= 0.75 ? "high" : item.confidenceScore >= 0.45 ? "medium" : "low",
            expected_penalty: item.reference.penalty ?? "공식 조문 확인 필요",
            reference_library: [item.reference]
          })),
          recommended_actions: [
            "전체 대화 문맥과 상대방 발언 전후 내용을 함께 보관하세요.",
            "원문 캡처, URL, 닉네임, 시간 정보 등 식별 가능한 증거를 함께 확보하세요."
          ],
          evidence_to_collect: [
            "대화 전문 캡처",
            "게시글 또는 메시지 원문 링크",
            "상대방 식별 정보와 발화 시각"
          ],
          precedent_cards: matchedPrecedents.map((item) => ({
            case_no: item.reference.caseNo ?? item.title,
            court: item.reference.court ?? item.reference.subtitle,
            verdict: item.reference.verdict ?? "판결",
            summary: item.matchReason,
            similarity_score: item.confidenceScore,
            reference_library: [item.reference]
          })),
          disclaimer,
          reference_library: allReferences,
          law_reference_library: matchedLaws.map((item) => item.reference),
          precedent_reference_library: matchedPrecedents.map((item) => item.reference)
        },
        law_reference_library: matchedLaws.map((item) => item.reference),
        precedent_reference_library: matchedPrecedents.map((item) => item.reference),
        reference_library: {
          items: allReferences
        }
      };

      const runId = await deps.keywordStore.saveRun({
        actor,
        providerMode: deps.providerMode,
        request,
        plan,
        response: responseWithoutId
      });

      return {
        run_id: runId,
        ...responseWithoutId
      };
    }
  };
}
