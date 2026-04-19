import type { LinkIngestionBlockReason } from "./types.js";

export class IngestionError extends Error {
  code: LinkIngestionBlockReason | "blocked" | "fetch_error" | "parse_error" | "timeout";
  status: number;
  detail?: string;

  constructor(
    message: string,
    options: {
      code: LinkIngestionBlockReason | "blocked" | "fetch_error" | "parse_error" | "timeout";
      status?: number;
      detail?: string;
    }
  ) {
    super(message);
    this.name = "IngestionError";
    this.code = options.code;
    this.status = options.status ?? 400;
    this.detail = options.detail;
  }
}

export function isIngestionError(error: unknown): error is IngestionError {
  return error instanceof Error && error.name === "IngestionError";
}
