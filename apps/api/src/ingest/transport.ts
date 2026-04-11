import http from "node:http";
import https from "node:https";
import { TextDecoder } from "node:util";

import { IngestionError } from "./errors.js";
import { assertSafeTarget } from "./net.js";
import type { FetchHtmlOptions, FetchHtmlResult } from "./types.js";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function contentTypeFromHeaders(headers: http.IncomingHttpHeaders) {
  const value = headerValue(headers["content-type"]);
  return value ? value.split(";")[0].trim().toLowerCase() : "";
}

function createTimeoutError() {
  return new IngestionError("Request timed out.", { code: "timeout", status: 504 });
}

function normalizeBodyText(buffer: Buffer, contentType: string) {
  const charsetMatch = /charset=([^;]+)/i.exec(contentType);
  const charset = charsetMatch?.[1]?.trim().replace(/^["']|["']$/g, "") || "utf-8";

  try {
    return new TextDecoder(charset as BufferEncoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

async function requestOnce(
  url: URL,
  options: FetchHtmlOptions,
  redirectCount: number
): Promise<FetchHtmlResult> {
  const target = await assertSafeTarget(url);
  const isHttps = target.url.protocol === "https:";
  const client = isHttps ? https : http;
  const headers: Record<string, string> = {
    Host: target.url.host,
    "User-Agent": options.userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "identity",
    Connection: "close"
  };

  return await new Promise<FetchHtmlResult>((resolve, reject) => {
    const request = client.request(
      {
        host: target.chosenAddress,
        port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
        method: "GET",
        path: `${target.url.pathname}${target.url.search}`,
        headers,
        servername: isHttps ? target.url.hostname : undefined,
        rejectUnauthorized: true
      } as https.RequestOptions,
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const contentType = contentTypeFromHeaders(response.headers);
        const location = headerValue(response.headers.location);

        if (REDIRECT_STATUS.has(statusCode) && location) {
          if (redirectCount >= options.followRedirects) {
            reject(
              new IngestionError("Too many redirects.", {
                code: "fetch_failed",
                status: 508
              })
            );
            response.resume();
            return;
          }

          const nextUrl = new URL(location, target.url);
          response.resume();
          void requestOnce(nextUrl, options, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode >= 400) {
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buffer.length;
            if (total > options.maxBytes) {
              request.destroy(
                new IngestionError("Error response exceeds configured size limit.", {
                  code: "payload_too_large",
                  status: 413
                })
              );
              return;
            }
            chunks.push(buffer);
          });
          response.on("end", () => {
            const body = chunks.length ? normalizeBodyText(Buffer.concat(chunks), contentType) : "";
            reject(
              new IngestionError(`Upstream returned HTTP ${statusCode}.`, {
                code: "fetch_failed",
                status: statusCode,
                detail: body.slice(0, 200)
              })
            );
          });
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        response.on("data", (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > options.maxBytes) {
            request.destroy(
              new IngestionError("Response exceeds configured size limit.", {
                code: "payload_too_large",
                status: 413
              })
            );
            return;
          }
          chunks.push(buffer);
        });

        response.on("error", reject);
        response.on("aborted", () => {
          reject(createTimeoutError());
        });
        response.on("end", () => {
          resolve({
            finalUrl: target.url.toString(),
            httpStatus: statusCode,
            contentType,
            ipAddress: target.chosenAddress,
            body: normalizeBodyText(Buffer.concat(chunks), contentType)
          });
        });
      }
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(createTimeoutError());
    });

    request.on("error", reject);
    request.end();
  });
}

export async function fetchHtml(url: URL, options: FetchHtmlOptions): Promise<FetchHtmlResult> {
  return requestOnce(url, options, 0);
}
