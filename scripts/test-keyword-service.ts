import { buildReferenceSeeds } from "../apps/api/src/analysis/references.js";
import { createKeywordVerificationService } from "../apps/api/src/retrieval/service.js";
import type { AnalysisStore } from "../apps/api/src/analysis/store.js";
import type { KeywordVerificationStore } from "../apps/api/src/retrieval/store.js";

function createReferenceLibraryStub(): Pick<AnalysisStore, "saveReferenceLibrary"> {
  return {
    async saveReferenceLibrary(input) {
      return buildReferenceSeeds(input.result as Record<string, unknown>, input.providerMode).map((seed) => ({
        id: seed.sourceKey,
        kind: seed.kind,
        href: `/api/references/${seed.kind}/${encodeURIComponent(seed.sourceKey)}`,
        title: seed.title,
        subtitle: seed.subtitle,
        summary: seed.summary,
        details: seed.details,
        url: seed.url,
        articleNo: seed.articleNo,
        caseNo: seed.caseNo,
        court: seed.court,
        verdict: seed.verdict,
        penalty: seed.penalty,
        similarityScore: seed.similarityScore,
        sourceMode: seed.sourceMode,
        keywords: seed.keywords,
        caseId: null,
        runId: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }));
    }
  };
}

function createKeywordStoreStub(): KeywordVerificationStore {
  return {
    async ensureSchema() {
      return;
    },
    async saveRun() {
      return "stub-run-id";
    }
  };
}

async function main(): Promise<void> {
  const service = createKeywordVerificationService({
    providerMode: "mock",
    analysisStore: createReferenceLibraryStub() as AnalysisStore,
    keywordStore: createKeywordStoreStub()
  });

  const result = await service.verifyKeyword({
    query: "패드립",
    contextType: "game_chat",
    limit: 3
  });

  if (!result.legal_analysis) {
    throw new Error("keyword service did not produce legal_analysis.");
  }

  if (result.matched_laws.length === 0) {
    throw new Error("expected at least one matched law.");
  }

  if (result.reference_library.items.length === 0) {
    throw new Error("expected reference_library items.");
  }

  process.stdout.write("Keyword service contract checks passed.\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
