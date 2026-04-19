import {
  buildPublicAnalysisResult,
  buildStoredAnalysisResult,
  buildStoredRuntimeArtifacts,
  type PublicAnalysisResult
} from "./privacy.js";
import type { AnalysisJobEvent } from "./jobs.js";
import type { AnalysisStore } from "./store.js";

interface PersistAnalysisRunInput {
  store: AnalysisStore;
  providerMode: string;
  jobId: string;
  result: Record<string, unknown>;
  timeline: AnalysisJobEvent[];
  profileContext: Record<string, unknown> | null;
  userId?: number | null;
  inputMode: "text" | "image" | "link";
  contextType: string;
  title: string;
  sourceKind: "manual" | "ocr" | "crawl";
  sourceUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  metadata: Record<string, unknown>;
}

export async function persistAnalysisRun(
  input: PersistAnalysisRunInput
): Promise<PublicAnalysisResult> {
  const storedResult = buildStoredAnalysisResult(input.result);
  const storedRuntimeArtifacts = buildStoredRuntimeArtifacts(input.result);
  let referenceLibrary;
  let persistedIds: { caseId?: string; runId?: string } | undefined;

  if (typeof input.userId === "number") {
    const saved = await input.store.saveAnalysis({
      userId: input.userId,
      inputMode: input.inputMode,
      contextType: input.contextType,
      title: input.title,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceUrl,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      contentText: "",
      metadata: input.metadata,
      providerMode: input.providerMode,
      result: storedResult,
      timeline: input.timeline,
      preview: storedRuntimeArtifacts.preview,
      trace: storedRuntimeArtifacts.trace,
      profileSnapshot: input.profileContext,
      persistSourceDocument: false
    });
    referenceLibrary = saved.referenceLibrary;
    persistedIds = {
      caseId: saved.caseId,
      runId: saved.runId
    };
  } else {
    referenceLibrary = await input.store.saveReferenceLibrary({
      providerMode: input.providerMode,
      result: input.result
    });
  }

  return buildPublicAnalysisResult(
    input.jobId,
    input.result,
    referenceLibrary,
    persistedIds
  );
}
