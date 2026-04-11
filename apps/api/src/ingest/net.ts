import dns from "node:dns/promises";
import net from "node:net";

import { IngestionError } from "./errors.js";

const PRIVATE_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase();
}

function isIpv4Private(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 0 || a === 255) {
    return true;
  }

  return false;
}

function isIpv4SpecialUse(address: string) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b, c] = parts;
  if (a >= 224) {
    return true;
  }
  if (a === 192 && b === 0 && c === 2) {
    return true;
  }
  if (a === 198 && b === 51 && c === 100) {
    return true;
  }
  if (a === 203 && b === 0 && c === 113) {
    return true;
  }

  return false;
}

function stripIpv6Zone(address: string) {
  const percentIndex = address.indexOf("%");
  return percentIndex >= 0 ? address.slice(0, percentIndex) : address;
}

function isIpv6Private(address: string) {
  const normalized = stripIpv6Zone(address).toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("::ffff:127.")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

function isIpv6SpecialUse(address: string) {
  const normalized = stripIpv6Zone(address).toLowerCase();
  if (normalized.startsWith("2001:db8:")) {
    return true;
  }
  if (normalized.startsWith("ff")) {
    return true;
  }

  return false;
}

export function isPrivateAddress(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    return isIpv4Private(address) || isIpv4SpecialUse(address);
  }
  if (family === 6) {
    return isIpv6Private(address) || isIpv6SpecialUse(address);
  }

  return false;
}

export function isSafeScheme(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}

export function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    PRIVATE_HOSTNAMES.has(normalized) ||
    normalized === "localhost.localdomain" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  );
}

export function assertSafeUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new IngestionError("URL is invalid.", { code: "invalid_url", status: 400 });
  }

  if (!isSafeScheme(url.protocol)) {
    throw new IngestionError("Only http and https URLs are allowed.", {
      code: "invalid_scheme",
      status: 400
    });
  }

  if (url.username || url.password) {
    throw new IngestionError("URLs with embedded credentials are not allowed.", {
      code: "unsafe_host",
      status: 400
    });
  }

  return url;
}

export async function resolveSafeAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname);

  if (net.isIP(normalized)) {
    if (isPrivateAddress(normalized)) {
      throw new IngestionError("Private and loopback IPs are not allowed.", {
        code: "unsafe_host",
        status: 403,
        detail: normalized
      });
    }

    return [normalized];
  }

  if (isBlockedHostname(normalized)) {
    throw new IngestionError("Localhost-style hostnames are not allowed.", {
      code: "unsafe_host",
      status: 403,
      detail: normalized
    });
  }

  const lookup = await dns.lookup(normalized, { all: true });
  const publicAddresses = lookup
    .map((entry) => entry.address)
    .filter((address) => !isPrivateAddress(address));

  if (publicAddresses.length === 0) {
    throw new IngestionError("Resolved addresses are private or loopback only.", {
      code: "unsafe_host",
      status: 403,
      detail: lookup.map((entry) => entry.address).join(", ")
    });
  }

  return publicAddresses;
}

export async function assertSafeTarget(url: URL) {
  const addresses = await resolveSafeAddresses(url.hostname);
  return {
    url,
    addresses,
    chosenAddress: addresses[0]
  };
}
