import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "./config.js";
import {
  buildAnalysisAcceptedEnvelope,
  buildAnalysisErrorEnvelope,
  buildAnalysisFailedEnvelope,
  buildAnalysisGuestLimitEnvelope,
  buildAnalysisPendingEnvelope,
  buildPublicAnalysisEvent,
  buildPublicAnalysisStreamEvent
} from "./http-envelope.js";
import {
  jsonResponse,
  parseAnalysisRoute,
  readJsonBody,
  resolveOrigin,
  type AnalysisHttpRouteHandler,
  writeSseEvent
} from "./http-shared.js";
import {
  prepareAnalysisRequestContext,
  type AnalysisHttpError,
  type AnalyzePayload
} from "./http-request-context.js";
import type { AnalysisJobEvent, AnalysisJobManager } from "./jobs.js";
import { persistAnalysisRun } from "./http-persistence.js";
import type { AnalysisStore, GuestUsageResult } from "./store.js";

interface CreateAnalyzeEndpointInput {
  authService: AuthService;
  authConfig: AuthConfig;
  analysisConfig: AnalysisConfig;
  store: AnalysisStore;
  jobManager: AnalysisJobManager;
  loadProfileContext: (userId: number) => Promise<Record<string, unknown> | null>;
}

async function runAnalysisBridge(
  request: Record<string, unknown>,
  options: {
    providerMode: string;
    userContext?: Record<string, unknown> | null;
    onEvent?: (event: AnalysisJobEvent) => void;
  }
): Promise<Record<string, unknown>> {
  const module = await import("../orchestrator/run-analysis.mjs");
  return module.runAnalysis(request, options) as Promise<Record<string, unknown>>;
}

export function createAnalyzeEndpoint(
  input: CreateAnalyzeEndpointInput
): AnalysisHttpRouteHandler {
  return async function handleAnalyzeRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (req.method === "GET") {
      const analysisRoute = parseAnalysisRoute(pathname);
      if (analysisRoute) {
        const job = input.jobManager.getJob(analysisRoute.jobId);
        if (!job) {
          jsonResponse(res, input.authConfig, 404, { error: "Analysis job not found." }, req);
          return true;
        }

        if (analysisRoute.stream) {
          const origin = resolveOrigin(input.authConfig, req);
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "access-control-allow-origin": origin,
            "access-control-allow-headers": "content-type, authorization, x-guest-id",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            vary: "Origin"
          });

          for (const event of job.events) {
            writeSseEvent(
              res,
              String(event.type),
              buildPublicAnalysisStreamEvent(analysisRoute.jobId, event) as Record<string, unknown>
            );
          }

          if (job.status === "completed" || job.status === "failed") {
            res.end();
            return true;
          }

          const unsubscribe = input.jobManager.subscribe(analysisRoute.jobId, (event) => {
            writeSseEvent(
              res,
              String(event.type),
              buildPublicAnalysisStreamEvent(analysisRoute.jobId, event) as Record<string, unknown>
            );
            if (event.type === "complete" || event.type === "error") {
              unsubscribe?.();
              res.end();
            }
          });

          req.on("close", () => {
            unsubscribe?.();
            if (!res.writableEnded) {
              res.end();
            }
          });

          return true;
        }

        if (job.status === "completed" && job.result) {
          jsonResponse(res, input.authConfig, 200, job.result, req);
          return true;
        }

        if (job.status === "failed") {
          jsonResponse(
            res,
            input.authConfig,
            500,
            buildAnalysisFailedEnvelope(job.id, job.status, job.error || "Analysis job failed."),
            req
          );
          return true;
        }

        jsonResponse(
          res,
          input.authConfig,
          202,
          buildAnalysisPendingEnvelope(job.id, job.status),
          req
        );
        return true;
      }
    }

    if (!(req.method === "POST" && pathname === "/api/analyze")) {
      return false;
    }

    let guestUsage: GuestUsageResult | null = null;

    try {
      const payload = (await readJsonBody(req, input.analysisConfig.requestBodyLimit)) as AnalyzePayload;
      const requestContext = await prepareAnalysisRequestContext({
        req,
        payload,
        authService: input.authService,
        authConfig: input.authConfig,
        analysisConfig: input.analysisConfig,
        store: input.store,
        loadProfileContext: input.loadProfileContext
      });
      guestUsage = requestContext.guestUsage;

      const job = input.jobManager.createJob();

      input.jobManager.startJob(job.id, async ({ emit }) => {
        const publicTimeline: AnalysisJobEvent[] = [];
        const emitPublicEvent = (event: AnalysisJobEvent) => {
          publicTimeline.push(event);
          emit(event);
        };

        const result = await runAnalysisBridge(requestContext.request, {
          providerMode: input.analysisConfig.providerMode,
          userContext: requestContext.profileContext ?? undefined,
          onEvent(event: AnalysisJobEvent) {
            emitPublicEvent(buildPublicAnalysisEvent(event));
          }
        });

        return persistAnalysisRun({
          store: input.store,
          providerMode: input.analysisConfig.providerMode,
          jobId: job.id,
          result: result as Record<string, unknown>,
          timeline: publicTimeline,
          profileContext: requestContext.profileContext,
          userId: requestContext.claims ? Number(requestContext.claims.sub) : null,
          inputMode: requestContext.inputMode,
          contextType: requestContext.contextType,
          title: requestContext.title,
          sourceKind: requestContext.sourceKind,
          sourceUrl: requestContext.sourceUrl,
          originalFilename: requestContext.originalFilename,
          mimeType: requestContext.mimeType,
          metadata: requestContext.metadata
        });
      });

      jsonResponse(
        res,
        input.authConfig,
        202,
        buildAnalysisAcceptedEnvelope(job.id, guestUsage),
        req
      );
    } catch (error) {
      const err = error as AnalysisHttpError;
      if (err.status === 429 && err.guestUsage) {
        jsonResponse(
          res,
          input.authConfig,
          429,
          buildAnalysisGuestLimitEnvelope(err.guestUsage),
          req
        );
        return true;
      }

      jsonResponse(
        res,
        input.authConfig,
        err.status ?? 500,
        buildAnalysisErrorEnvelope(
          err.message || "Internal server error.",
          guestUsage ?? err.guestUsage ?? null
        ),
        req
      );
    }

    return true;
  };
}
