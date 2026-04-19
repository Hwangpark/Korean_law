import crypto from "node:crypto";
import fs from "node:fs";

import { config as loadDotenv } from "dotenv";

if (fs.existsSync(".env.local")) {
  loadDotenv({ path: ".env.local", override: false });
} else if (fs.existsSync(".env")) {
  loadDotenv({ path: ".env", override: false });
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
  expiresInSeconds: number;
}

export interface EmailConfig {
  user: string;
  appPassword: string;
  enabled: boolean;
  baseUrl: string;
}

export interface AuthConfig {
  port: number;
  corsOrigins: string[];
  trustedProxyAddresses: string[];
  database: DatabaseConfig;
  jwt: JwtConfig;
  email: EmailConfig;
  nodeEnv: string;
  requestBodyLimit: number;
  requestIdPrefix: string;
}

function parseIntOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireInProduction(
  value: string | undefined,
  fallback: string,
  name: string,
  nodeEnv: string
): string {
  if (value) {
    return value;
  }

  if (nodeEnv === "production") {
    throw new Error(`${name} must be set in production.`);
  }

  return fallback;
}

function parseDatabaseUrl(databaseUrl: string): DatabaseConfig {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`Unsupported DATABASE_URL protocol: ${url.protocol}`);
  }

  return {
    host: url.hostname || "127.0.0.1",
    port: url.port ? Number.parseInt(url.port, 10) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "koreanlaw",
    user: decodeURIComponent(url.username || "park"),
    password: decodeURIComponent(url.password || "park8948")
  };
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const database = env.DATABASE_URL
    ? parseDatabaseUrl(env.DATABASE_URL)
    : {
        host: env.PGHOST || env.POSTGRES_HOST || "127.0.0.1",
        port: parseIntOr(env.PGPORT || env.POSTGRES_PORT, 5432),
        database: env.PGDATABASE || env.POSTGRES_DB || "koreanlaw",
        user: env.PGUSER || env.POSTGRES_USER || "park",
        password: requireInProduction(
          env.PGPASSWORD || env.POSTGRES_PASSWORD,
          "park8948",
          "POSTGRES_PASSWORD",
          nodeEnv
        )
      };

  const port = parseIntOr(env.AUTH_PORT || env.API_PORT, 3001);
  const gmailUser = env.GMAIL_USER || "minstock.official@gmail.com";
  const gmailPass = env.GMAIL_APP_PASSWORD || "";

  const corsOriginEnv = env.AUTH_CORS_ORIGIN || (nodeEnv === "development" ? "http://localhost:5173" : "*");
  const corsOrigins = corsOriginEnv.split(",").map((s) => s.trim()).filter(Boolean);
  const trustedProxyAddresses = (
    env.AUTH_TRUST_PROXY_IPS ||
    env.API_TRUST_PROXY_IPS ||
    env.TRUST_PROXY_IPS ||
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    port,
    corsOrigins,
    trustedProxyAddresses,
    jwt: {
      secret: requireInProduction(
        env.AUTH_JWT_SECRET,
        "koreanlaw-dev-jwt-secret",
        "AUTH_JWT_SECRET",
        nodeEnv
      ),
      issuer: env.AUTH_JWT_ISSUER || "koreanlaw-auth",
      audience: env.AUTH_JWT_AUDIENCE || "koreanlaw-app",
      expiresInSeconds: parseIntOr(env.AUTH_JWT_TTL_SECONDS, 60 * 60 * 24 * 7)
    },
    database,
    email: {
      user: gmailUser,
      appPassword: gmailPass,
      enabled: gmailPass.length > 0,
      baseUrl: env.AUTH_PUBLIC_URL || `http://localhost:${port}`,
    },
    nodeEnv,
    requestBodyLimit: parseIntOr(env.AUTH_BODY_LIMIT_BYTES, 1_048_576),
    requestIdPrefix: env.AUTH_REQUEST_PREFIX || `auth-${crypto.randomBytes(4).toString("hex")}`
  };
}
