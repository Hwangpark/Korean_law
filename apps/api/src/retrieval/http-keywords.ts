import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";
import type { AuthService } from "../auth/service.js";
import type { AnalysisConfig } from "../analysis/config.js";
import { buildProfileContext } from "../analysis/profile-context.js";
import { resolveClientIp } from "../http/client-ip.js";
import type { AnalysisStore } from "../analysis/store.js";
import {
  buildKeywordAuthenticatedEnvelope,
  buildKeywordGuestEnvelope,
  buildKeywordGuestLimitEnvelope
} from "./http-envelope.js";
import { buildPublicKeywordVerificationResponse } from "./privacy.js";
import type { KeywordVerificationService } from "./service.js";
import type { KeywordContextType } from "./types.js";
import {
  extractBearerToken,
  jsonResponse,
  readJsonBody,
  type RetrievalHttpError,
  type RetrievalHttpRouteHandler
} from "./http-shared.js";

interface VerifyPayload {
  query?: string;
  context_type?: KeywordContextType;
  guest_id?: string;
  limit?: number;
}

const ALLOWED_CONTEXT_TYPES = new Set<KeywordContextType>([
  "community",
  "game_chat",
  "messenger",
  "other"
]);

interface CreateKeywordEndpointInput {
  authService: AuthService;
  authConfig: AuthConfig;
  analysisConfig: AnalysisConfig;
  analysisStore: AnalysisStore;
  keywordService: KeywordVerificationService;
}

function requireString(value: unknown, message: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error(message) as RetrievalHttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function requireGuestId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    const error = new Error("guest_id is required for guest verification.") as RetrievalHttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

function parseContextType(value: unknown): KeywordContextType {
  const normalized = String(value ?? "community").trim() as KeywordContextType;
  if (!ALLOWED_CONTEXT_TYPES.has(normalized)) {
    const error = new Error(
      "context_type must be one of community, game_chat, messenger, other."
    ) as RetrievalHttpError;
    error.status = 422;
    throw error;
  }
  return normalized;
}

export function createKeywordEndpoint(
  input: CreateKeywordEndpointInput
): RetrievalHttpRouteHandler {
  const authProfileService = input.authService as AuthService & {
    getUserProfile?: (userId: number) => Promise<Record<string, unknown> | null>;
  };

  async function loadProfileContext(userId: number): Promise<Record<string, unknown> | null> {
    if (!authProfileService.getUserProfile) {
      return null;
    }

    const profile = await authProfileService.getUserProfile(userId);
    const context = buildProfileContext(profile);
    return context ? (context as unknown as Record<string, unknown>) : null;
  }

  return async function handleKeywordVerificationRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (pathname !== "/api/keywords/verify") {
      return false;
    }

    if (req.method !== "POST") {
      jsonResponse(res, input.authConfig, 405, { error: "Method not allowed." }, req);
      return true;
    }

    try {
      const payload = (await readJsonBody(req, input.analysisConfig.requestBodyLimit)) as VerifyPayload;
      const query = requireString(payload.query, "query field is required.");
      const contextType = parseContextType(payload.context_type);
      const limit =
        typeof payload.limit === "number" && Number.isFinite(payload.limit)
          ? Math.min(Math.max(Math.floor(payload.limit), 1), 6)
          : 4;
      const token = extractBearerToken(req.headers.authorization);

      if (token) {
        const claims = await input.authService.verifyToken(token);
        const profileContext = await loadProfileContext(Number(claims.sub));
        const result = await input.keywordService.verifyKeyword(
          {
            query,
            contextType,
            limit,
            profileContext: profileContext ?? undefined
          },
          {
            userId: Number(claims.sub)
          }
        );
        const publicResult = buildPublicKeywordVerificationResponse(result);
        jsonResponse(
          res,
          input.authConfig,
          200,
          buildKeywordAuthenticatedEnvelope(publicResult, profileContext),
          req
        );
        return true;
      }

      const guestIdCandidate = String(req.headers["x-guest-id"] ?? payload.guest_id ?? "").trim();
      const guestId = guestIdCandidate ? requireGuestId(guestIdCandidate) : null;
      const guestUsage = await input.analysisStore.consumeGuestAnalysis(
        {
          guestId,
          ipAddress: resolveClientIp(input.authConfig, req)
        },
        10
      );
      if (!guestUsage.allowed) {
        jsonResponse(res, input.authConfig, 429, buildKeywordGuestLimitEnvelope(guestUsage), req);
        return true;
      }

      const result = await input.keywordService.verifyKeyword(
        {
          query,
          contextType,
          limit
        },
        {
          ...(guestId ? { guestId } : {})
        }
      );
      const publicResult = buildPublicKeywordVerificationResponse(result);

      jsonResponse(
        res,
        input.authConfig,
        200,
        buildKeywordGuestEnvelope(publicResult, guestUsage),
        req
      );
      return true;
    } catch (error) {
      const err = error as RetrievalHttpError;
      jsonResponse(
        res,
        input.authConfig,
        err.status ?? 500,
        {
          error: err.message || "Internal server error."
        },
        req
      );
      return true;
    }
  };
}
