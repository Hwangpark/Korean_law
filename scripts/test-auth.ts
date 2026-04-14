import assert from "node:assert/strict";
import fs from "node:fs";

import { config as loadDotenv } from "dotenv";
import { Client } from "pg";

if (fs.existsSync(".env.local")) {
  loadDotenv({ path: ".env.local", override: false });
} else if (fs.existsSync(".env")) {
  loadDotenv({ path: ".env", override: false });
}

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
const ME_PATHS = splitCsv(process.env.AUTH_ME_PATHS ?? "/api/auth/me,/auth/me");
const REQUEST_CODE_PATHS = splitCsv(
  process.env.AUTH_REQUEST_CODE_PATHS ??
    "/api/auth/request-email-code,/auth/request-email-code"
);

const config = {
  baseUrl: trimTrailingSlash(process.env.AUTH_BASE_URL ?? DEFAULT_BASE_URL),
  email: process.env.AUTH_EMAIL ?? makeEmail(),
  password: process.env.AUTH_PASSWORD ?? DEFAULT_PASSWORD,
  name: process.env.AUTH_NAME ?? "Codex Smoke Test",
  birthDate: process.env.AUTH_BIRTH_DATE ?? "1999-01-01",
  gender: process.env.AUTH_GENDER ?? "male",
  nationality: process.env.AUTH_NATIONALITY ?? "korean",
  registerBodyJson: process.env.AUTH_REGISTER_BODY_JSON ?? "",
  loginBodyJson: process.env.AUTH_LOGIN_BODY_JSON ?? "",
  emailField: process.env.AUTH_EMAIL_FIELD ?? "email",
  passwordField: process.env.AUTH_PASSWORD_FIELD ?? "password",
  nameField: process.env.AUTH_NAME_FIELD ?? "name",
  birthDateField: process.env.AUTH_BIRTH_DATE_FIELD ?? "birth_date",
  genderField: process.env.AUTH_GENDER_FIELD ?? "gender",
  nationalityField: process.env.AUTH_NATIONALITY_FIELD ?? "nationality",
  verificationField: process.env.AUTH_VERIFICATION_FIELD ?? "verification_code"
};

async function main(): Promise<void> {
  const registerPayloadBase = buildPayload({
    template: config.registerBodyJson,
    fallback: {
      [config.emailField]: config.email,
      [config.passwordField]: config.password,
      [config.nameField]: config.name,
      [config.birthDateField]: config.birthDate,
      [config.genderField]: config.gender,
      [config.nationalityField]: config.nationality
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

  const verificationCode = await maybeIssueVerificationCode();
  const registerPayload = verificationCode
    ? {
        ...registerPayloadBase,
        [config.verificationField]: verificationCode
      }
    : registerPayloadBase;

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

  const loginJsonRaw = tryParseJson(loginResponse.bodyText);
  const token = extractToken(loginJsonRaw);
  const setCookie = loginResponse.headers["set-cookie"];

  assert.ok(token || setCookie, "login should return a token-like field or set-cookie header");
  const tokenValue = token?.value ?? null;
  assert.ok(tokenValue, "login should return a usable token");

  const registerJson = tryParseJson(registerResponse.bodyText);
  const loginJson = loginJsonRaw;
  const registerProfile = extractProfile(registerJson);
  const loginProfile = extractProfile(loginJson);
  const expectedProfile = expectedProfileShape({
    name: config.name,
    birthDate: config.birthDate,
    gender: config.gender,
    nationality: config.nationality
  });

  assertProfileMatches(registerProfile, expectedProfile, "register response");
  assertProfileMatches(loginProfile, expectedProfile, "login response");

  const meResponse = await getAuthorizedResponse({
    paths: ME_PATHS,
    token: tokenValue
  });
  const meJson = tryParseJson(meResponse.bodyText);
  const meProfile = extractProfile(meJson);
  assertProfileMatches(meProfile, expectedProfile, "me response");

  const dbProfile = await fetchLatestProfile(config.email);
  assertProfileMatches(dbProfile, expectedStoredProfileShape({
    name: config.name,
    birthDate: config.birthDate,
    gender: config.gender,
    nationality: config.nationality
  }), "database profile");

  process.stdout.write(
    `${JSON.stringify(
      {
        baseUrl: config.baseUrl,
        email: config.email,
        registerPath: registerResponse.path,
        loginPath: loginResponse.path,
        mePath: meResponse.path,
        tokenField: token?.field ?? null,
        cookieSet: Boolean(setCookie),
        profileChecked: true
      },
      null,
      2
    )}\n`
  );
}

async function maybeIssueVerificationCode(): Promise<string | null> {
  let requestWorked = false;

  for (const path of REQUEST_CODE_PATHS) {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain;q=0.9, */*;q=0.8"
      },
      body: JSON.stringify({
        [config.emailField]: config.email
      })
    });

    if (response.status === 404) {
      continue;
    }

    requestWorked = response.ok;
    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(
        `request-email-code failed at ${path} with ${response.status}: ${bodyText || "<empty response>"}`
      );
    }
    break;
  }

  if (!requestWorked) {
    return null;
  }

  return fetchLatestVerificationCode(config.email);
}

async function fetchLatestVerificationCode(email: string): Promise<string | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<{ code: string }>(
      `SELECT code
       FROM email_verification_codes
       WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    return result.rows[0]?.code ?? null;
  } finally {
    await client.end();
  }
}

async function fetchLatestProfile(email: string): Promise<Record<string, unknown> | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to verify profile storage");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<{
      display_name: string;
      birth_date: string;
      gender: string;
      nationality: string;
    }>(
      `SELECT p.display_name, p.birth_date::text AS birth_date, p.gender, p.nationality
       FROM auth_users u
       JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = $1
       ORDER BY u.id DESC
       LIMIT 1`,
      [email]
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      displayName: row.display_name,
      birthDate: row.birth_date,
      gender: row.gender,
      nationality: row.nationality
    };
  } finally {
    await client.end();
  }
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
      .replaceAll("{{name}}", values.name)
      .replaceAll("{{displayName}}", values.name)
      .replaceAll("{{birthDate}}", values.birthDate)
      .replaceAll("{{birth_date}}", values.birthDate)
      .replaceAll("{{gender}}", values.gender)
      .replaceAll("{{nationality}}", values.nationality);
  }

  return value;
}

async function getAuthorizedResponse(args: {
  paths: string[];
  token: string;
}): Promise<{
  path: string;
  status: number;
  bodyText: string;
  headers: Record<string, string>;
}> {
  let lastError: Error | null = null;

  for (const path of args.paths) {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${args.token}`,
        accept: "application/json, text/plain;q=0.9, */*;q=0.8"
      }
    });

    const bodyText = await response.text();

    if (response.status === 404) {
      lastError = new Error(`authorized endpoint not found at ${path}`);
      continue;
    }

    if (!response.ok) {
      throw new Error(`authorized request failed at ${path} with ${response.status}: ${bodyText || "<empty response>"}`);
    }

    return {
      path,
      status: response.status,
      bodyText,
      headers: Object.fromEntries(response.headers.entries())
    };
  }

  throw lastError ?? new Error("no authorized endpoint responded");
}

function extractProfile(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") {
    return null;
  }

  const direct = (json as Record<string, unknown>).profile;
  if (direct && typeof direct === "object") {
    return direct as Record<string, unknown>;
  }

  const user = (json as Record<string, unknown>).user;
  if (user && typeof user === "object") {
    const nested = (user as Record<string, unknown>).profile;
    if (nested && typeof nested === "object") {
      return nested as Record<string, unknown>;
    }
  }

  return null;
}

function expectedProfileShape(input: {
  name: string;
  birthDate: string;
  gender: string;
  nationality: string;
}): Record<string, unknown> {
  return {
    displayName: input.name,
    birthDate: input.birthDate,
    gender: normalizeExpectedGender(input.gender),
    nationality: normalizeExpectedNationality(input.nationality),
    ...deriveAgeFields(input.birthDate)
  };
}

function expectedStoredProfileShape(input: {
  name: string;
  birthDate: string;
  gender: string;
  nationality: string;
}): Record<string, unknown> {
  return {
    displayName: input.name,
    birthDate: input.birthDate,
    gender: normalizeExpectedGender(input.gender),
    nationality: normalizeExpectedNationality(input.nationality)
  };
}

function normalizeExpectedGender(value: string): string {
  switch (value) {
    case "남":
    case "남성":
      return "male";
    case "여":
    case "여성":
      return "female";
    default:
      return value;
  }
}

function normalizeExpectedNationality(value: string): string {
  switch (value) {
    case "내국인":
      return "korean";
    case "외국인":
      return "foreign";
    default:
      return value;
  }
}

function deriveAgeFields(birthDate: string): Record<string, unknown> {
  const parsed = new Date(`${birthDate}T00:00:00.000Z`);
  const today = new Date();
  let ageYears = today.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - parsed.getUTCMonth();
  const dayDiff = today.getUTCDate() - parsed.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    ageYears -= 1;
  }

  const isMinor = ageYears < 19;
  const ageBand = ageYears < 18 ? "child" : isMinor ? "minor" : "adult";
  return {
    ageYears,
    ageBand,
    isMinor
  };
}

function assertProfileMatches(actual: Record<string, unknown> | null, expected: Record<string, unknown>, label: string): void {
  assert.ok(actual, `${label} should include a profile`);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual?.[key], value, `${label} profile field ${key} should match`);
  }
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
