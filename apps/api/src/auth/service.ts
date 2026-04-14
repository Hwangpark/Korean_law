import crypto from "node:crypto";

import type { AuthConfig } from "./config.js";
import { createEmailService } from "./email.js";
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
  requestEmailCode(payload: Record<string, unknown>): Promise<AuthResponse>;
  verifyEmailCode(payload: Record<string, unknown>): Promise<AuthResponse>;
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
  const emailService = createEmailService(config.email);

  async function ensureSchema(): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      ALTER TABLE auth_users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email)`);
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

  async function requestEmailCode(payload: Record<string, unknown>): Promise<AuthResponse> {
    const email = normalizeEmail(payload.email);
    if (!email) {
      return { status: 400, body: { error: "이메일을 입력해주세요." } };
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return { status: 409, body: { error: "이미 가입된 이메일입니다." } };
    }

    // invalidate previous codes
    await db.query(
      `UPDATE email_verification_codes SET used_at = NOW() WHERE email = $1 AND used_at IS NULL`,
      [email]
    );

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    await db.query(
      `INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, code, expiresAt]
    );

    emailService.sendVerificationCode(email, code).catch((err) => {
      console.error("[email] Failed to send code:", err);
    });

    return {
      status: 200,
      body: {
        message: config.email.enabled
          ? "인증 코드를 발송했습니다. 이메일을 확인해주세요."
          : "이메일 서비스가 설정되지 않아 개발용 인증 코드를 반환합니다.",
        delivery: config.email.enabled ? "email" : "debug",
        ...(config.email.enabled || config.nodeEnv === "production" ? {} : { debug_code: code })
      }
    };
  }

  async function signup(payload: Record<string, unknown>): Promise<AuthResponse> {
    const email = normalizeEmail(payload.email);
    const password = String(payload.password ?? "");
    const code = String(payload.verification_code ?? "").trim();

    if (!email) {
      return { status: 400, body: { error: "이메일을 입력해주세요." } };
    }
    if (!password) {
      return { status: 400, body: { error: "비밀번호를 입력해주세요." } };
    }
    if (!code) {
      return { status: 400, body: { error: "이메일 인증 코드를 입력해주세요." } };
    }

    const policyError = passwordPolicy(password);
    if (policyError) {
      return { status: 400, body: { error: policyError } };
    }

    // verify code
    const codeResult = await db.query<{ id: string }>(
      `SELECT id FROM email_verification_codes
       WHERE email = $1 AND code = $2 AND expires_at > NOW() AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );

    if ((codeResult.rowCount ?? 0) === 0) {
      return { status: 400, body: { error: "인증 코드가 올바르지 않거나 만료되었습니다." } };
    }

    // mark code used
    await db.query(
      `UPDATE email_verification_codes SET used_at = NOW() WHERE id = $1`,
      [codeResult.rows[0].id]
    );

    const existing = await getUserByEmail(email);
    if (existing) {
      return { status: 409, body: { error: "이미 가입된 이메일입니다." } };
    }

    const passwordHash = await hashPassword(password);
    const created = await db.query<Pick<StoredUserRow, "id" | "email">>(
      `INSERT INTO auth_users (email, password_hash, email_verified) VALUES ($1, $2, TRUE) RETURNING id, email`,
      [email, passwordHash]
    );

    return {
      status: 201,
      body: { ...buildTokenResponse(created.rows[0]), message: "가입이 완료되었습니다." }
    };
  }

  async function verifyEmailCode(payload: Record<string, unknown>): Promise<AuthResponse> {
    const email = normalizeEmail(payload.email);
    const code = String(payload.verification_code ?? "").trim();

    if (!email) {
      return { status: 400, body: { error: "이메일을 입력해주세요." } };
    }

    if (!code) {
      return { status: 400, body: { error: "인증 코드를 입력해주세요." } };
    }

    const codeResult = await db.query<{ id: string }>(
      `SELECT id
       FROM email_verification_codes
       WHERE email = $1
         AND code = $2
         AND expires_at > NOW()
         AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [email, code]
    );

    if ((codeResult.rowCount ?? 0) === 0) {
      return { status: 400, body: { error: "인증 코드가 올바르지 않거나 만료되었습니다." } };
    }

    return {
      status: 200,
      body: {
        message: "이메일 인증이 완료되었습니다.",
        verified: true
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
      return verifyJwt(token, {
        secret: config.jwt.secret,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        type: "access"
      });
    } catch (error) {
      const authError = error instanceof Error ? error : new Error("Unauthorized.");
      (authError as Error & { status?: number }).status = 401;
      throw authError;
    }
  }

  return {
    ensureSchema,
    requestEmailCode,
    verifyEmailCode,
    signup,
    login,
    verifyToken: verifyTokenValue,
    close: () => db.close()
  };
}
