import type { AuthConfig } from "./config.js";
import { buildAccessToken, verifyJwt, type JwtPayload } from "./jwt.js";
import { hashPassword, normalizeEmail, passwordPolicy, verifyPassword } from "./password.js";
import { createPostgresClient } from "./postgres.js";

interface StoredUserRow {
  id: string;
  email: string;
  password_hash: string;
}

interface PublicUser {
  id: number;
  email: string;
}

interface AuthResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface AuthService {
  ensureSchema(): Promise<void>;
  signup(payload: Record<string, unknown>): Promise<AuthResponse>;
  login(payload: Record<string, unknown>): Promise<AuthResponse>;
  verifyToken(token: string): Promise<JwtPayload>;
  close(): Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPublicUser(user: Pick<StoredUserRow, "id" | "email">): PublicUser {
  return {
    id: Number(user.id),
    email: user.email
  };
}

export function createAuthService(config: AuthConfig): AuthService {
  const db = createPostgresClient(config.database);

  async function ensureSchema(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async function getUserByEmail(email: string): Promise<StoredUserRow | null> {
    const result = await db.query<StoredUserRow>(
      "SELECT id, email, password_hash FROM auth_users WHERE email = $1 LIMIT 1",
      [email]
    );
    return result.rows[0] ?? null;
  }

  function buildTokenResponse(user: Pick<StoredUserRow, "id" | "email">): Record<string, unknown> {
    const token = buildAccessToken({ id: user.id, email: user.email }, config.jwt);
    const issuedAt = nowIso();
    const expiresIn = config.jwt.expiresInSeconds;

    return {
      accessToken: token,
      token,
      tokenType: "Bearer",
      token_type: "Bearer",
      expiresIn,
      expires_in: expiresIn,
      user: toPublicUser(user),
      issuedAt,
      issued_at: issuedAt
    };
  }

  async function signup(payload: Record<string, unknown>): Promise<AuthResponse> {
    const email = normalizeEmail(payload.email);
    const password = String(payload.password ?? "");

    if (!email) {
      return { status: 400, body: { error: "Email is required." } };
    }
    if (!password) {
      return { status: 400, body: { error: "Password is required." } };
    }

    const policyError = passwordPolicy(password);
    if (policyError) {
      return { status: 400, body: { error: policyError } };
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return { status: 409, body: { error: "Email is already registered." } };
    }

    const passwordHash = await hashPassword(password);
    const created = await db.query<Pick<StoredUserRow, "id" | "email">>(
      "INSERT INTO auth_users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, passwordHash]
    );

    return {
      status: 201,
      body: {
        ...buildTokenResponse(created.rows[0]),
        message: "Signup completed."
      }
    };
  }

  async function login(payload: Record<string, unknown>): Promise<AuthResponse> {
    const email = normalizeEmail(payload.email);
    const password = String(payload.password ?? "");

    if (!email) {
      return { status: 400, body: { error: "Email is required." } };
    }
    if (!password) {
      return { status: 400, body: { error: "Password is required." } };
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return { status: 401, body: { error: "Invalid email or password." } };
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return { status: 401, body: { error: "Invalid email or password." } };
    }

    return {
      status: 200,
      body: {
        ...buildTokenResponse(user),
        message: "Login successful."
      }
    };
  }

  async function verifyTokenValue(token: string): Promise<JwtPayload> {
    try {
      return verifyJwt(token, config.jwt.secret);
    } catch (error) {
      const authError = error instanceof Error ? error : new Error("Unauthorized.");
      (authError as Error & { status?: number }).status = 401;
      throw authError;
    }
  }

  return {
    ensureSchema,
    signup,
    login,
    verifyToken: verifyTokenValue,
    close: () => db.close()
  };
}
