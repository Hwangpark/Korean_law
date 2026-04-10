import assert from "node:assert/strict";

const DEFAULT_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_PASSWORD = "Park8948!";

const REGISTER_PATHS = splitCsv(
  process.env.AUTH_REGISTER_PATHS ??
    "/api/auth/register,/api/register,/auth/register,/api/auth/signup,/auth/signup"
);
const LOGIN_PATHS = splitCsv(
  process.env.AUTH_LOGIN_PATHS ??
    "/api/auth/login,/api/login,/auth/login,/api/auth/signin"
);

const config = {
  baseUrl: trimTrailingSlash(process.env.AUTH_BASE_URL ?? DEFAULT_BASE_URL),
  email: process.env.AUTH_EMAIL ?? makeEmail(),
  password: process.env.AUTH_PASSWORD ?? DEFAULT_PASSWORD,
  name: process.env.AUTH_NAME ?? "Codex Smoke Test",
  registerBodyJson: process.env.AUTH_REGISTER_BODY_JSON ?? "",
  loginBodyJson: process.env.AUTH_LOGIN_BODY_JSON ?? "",
  emailField: process.env.AUTH_EMAIL_FIELD ?? "email",
  passwordField: process.env.AUTH_PASSWORD_FIELD ?? "password",
  nameField: process.env.AUTH_NAME_FIELD ?? "name"
};

async function main(): Promise<void> {
  const registerPayload = buildPayload({
    template: config.registerBodyJson,
    fallback: {
      [config.emailField]: config.email,
      [config.passwordField]: config.password,
      [config.nameField]: config.name
    },
    values: config
  });

  const loginPayload = buildPayload({
    template: config.loginBodyJson,
    fallback: {
      [config.emailField]: config.email,
      [config.passwordField]: config.password
    },
    values: config
  });

  const registerResponse = await postToFirstWorkingEndpoint({
    label: "register",
    paths: REGISTER_PATHS,
    payload: registerPayload
  });

  assert.ok(
    [200, 201, 204].includes(registerResponse.status),
    `register should succeed, got ${registerResponse.status}`
  );

  const loginResponse = await postToFirstWorkingEndpoint({
    label: "login",
    paths: LOGIN_PATHS,
    payload: loginPayload
  });

  assert.ok(
    [200, 204].includes(loginResponse.status),
    `login should succeed, got ${loginResponse.status}`
  );

  const loginJson = tryParseJson(loginResponse.bodyText);
  const token = extractToken(loginJson);
  const setCookie = loginResponse.headers["set-cookie"];

  assert.ok(token || setCookie, "login should return a token-like field or set-cookie header");

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl: config.baseUrl,
        email: config.email,
        registerPath: registerResponse.path,
        loginPath: loginResponse.path,
        tokenField: token?.field ?? null,
        cookieSet: Boolean(setCookie)
      },
      null,
      2
    )}\n`
  );
}

async function postToFirstWorkingEndpoint(args: {
  label: string;
  paths: string[];
  payload: Record<string, unknown>;
}): Promise<{
  path: string;
  status: number;
  bodyText: string;
  headers: Record<string, string>;
}> {
  let lastError: Error | null = null;

  for (const path of args.paths) {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain;q=0.9, */*;q=0.8"
      },
      body: JSON.stringify(args.payload)
    });

    const bodyText = await response.text();

    if (response.status === 404) {
      lastError = new Error(`${args.label} endpoint not found at ${path}`);
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `${args.label} request failed at ${path} with ${response.status}: ${bodyText || "<empty response>"}`
      );
    }

    return {
      path,
      status: response.status,
      bodyText,
      headers: Object.fromEntries(response.headers.entries())
    };
  }

  throw lastError ?? new Error(`no ${args.label} endpoint responded`);
}

function buildPayload(args: {
  template: string;
  fallback: Record<string, unknown>;
  values: typeof config;
}): Record<string, unknown> {
  if (!args.template) {
    return args.fallback;
  }

  const parsed = JSON.parse(args.template) as unknown;
  return replacePlaceholders(parsed, args.values) as Record<string, unknown>;
}

function replacePlaceholders(value: unknown, values: typeof config): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, values));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replacePlaceholders(item, values)
      ])
    );
  }

  if (typeof value === "string") {
    return value
      .replaceAll("{{email}}", values.email)
      .replaceAll("{{password}}", values.password)
      .replaceAll("{{name}}", values.name);
  }

  return value;
}

function extractToken(json: unknown): { field: string; value: string } | null {
  if (!json || typeof json !== "object") {
    return null;
  }

  const candidates = ["token", "accessToken", "jwt", "sessionToken"];
  for (const field of candidates) {
    const value = (json as Record<string, unknown>)[field];
    if (typeof value === "string" && value.length > 0) {
      return { field, value };
    }
  }

  const data = (json as Record<string, unknown>).data;
  if (data && typeof data === "object") {
    for (const field of candidates) {
      const value = (data as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length > 0) {
        return { field: `data.${field}`, value };
      }
    }
  }

  return null;
}

function tryParseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function makeEmail(): string {
  return `codex-auth-${Date.now()}-${process.pid}@example.test`;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
