import type http from "node:http";

import type { AuthConfig } from "../auth/config.js";

function normalizeIpAddress(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized === "::1") {
    return "127.0.0.1";
  }
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}

function isTrustedProxy(config: AuthConfig, remoteAddress: string): boolean {
  if (!remoteAddress) {
    return false;
  }

  return config.trustedProxyAddresses
    .map((value) => normalizeIpAddress(value))
    .includes(remoteAddress);
}

export function resolveClientIp(config: AuthConfig, req: http.IncomingMessage): string {
  const remoteAddress = normalizeIpAddress(req.socket.remoteAddress);

  if (!isTrustedProxy(config, remoteAddress)) {
    return remoteAddress;
  }

  const forwardedAddress = normalizeIpAddress(
    String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((part) => part.trim())
      .find(Boolean)
  );

  return forwardedAddress || remoteAddress;
}
