import crypto from "node:crypto";

import type { AuthConfig } from "./config.js";
import { createEmailService } from "./email.js";
import { buildAccessToken, verifyJwt, type JwtPayload } from "./jwt.js";
import { hashPassword, normalizeEmail, passwordPolicy, verifyPassword } from "./password.js";
import { createPostgresClient, type PostgresClient } from "./postgres.js";
import {
  createPublicUserProfile,
  normalizeProfilePayload,
  toPublicUserProfile,
  type PublicUserProfile
} from "./profile.js";

interface StoredUserRow {
  id: string;
  email: string;
  password_hash: string;
  profile_display_name: string | null;
  profile_birth_date: string | null;
  profile_gender: string | null;
  profile_nationality: string | null;
}

interface PublicUser {
  id: number;
  email: string;
  profile: PublicUserProfile | null;
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
  getUserProfile(userId: number): Promise<PublicUserProfile | null>;
  verifyToken(token: string): Promise<JwtPayload>;
  close(): Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPublicUser(user: Pick<StoredUserRow, "id" | "email">, profile: PublicUserProfile | null): PublicUser {
  return {
    id: Number(user.id),
    email: user.email,
    profile
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
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id BIGINT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        birth_date DATE NOT NULL,
        gender TEXT NOT NULL,
        nationality TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS birth_date DATE`);
    await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS gender TEXT`);
    await db.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS nationality TEXT`);
    await db.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await db.query(`
      ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  async function getUserByEmail(email: string, client: PostgresClient = db): Promise<StoredUserRow | null> {
    const result = await client.query<StoredUserRow>(
      `SELECT
         u.id,
         u.email,
         u.password_hash,
         p.display_name AS profile_display_name,
         p.birth_date::text AS profile_birth_date,
         p.gender AS profile_gender,
         p.nationality AS profile_nationality
       FROM auth_users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = $1
       LIMIT 1`,
      [email]
    );
    return result.rows[0] ?? null;
  }

  async function getUserProfile(userId: number, client: PostgresClient = db): Promise<PublicUserProfile | null> {
    const result = await client.query<
      Pick<
        StoredUserRow,
        "profile_display_name" | "profile_birth_date" | "profile_gender" | "profile_nationality"
      >
    >(
      `SELECT
         display_name AS profile_display_name,
         birth_date::text AS profile_birth_date,
         gender AS profile_gender,
         nationality AS profile_nationality
       FROM user_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    return toPublicUserProfile(result.rows[0] ?? null);
  }

  function buildTokenResponse(user: Pick<StoredUserRow, "id" | "email">, profile: PublicUserProfile | null): Record<string, unknown> {
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
      user: toPublicUser(user, profile),
      profile,
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

    await db.query(`UPDATE email_verification_codes SET used_at = NOW() WHERE email = $1 AND used_at IS NULL`, [email]);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.query(`INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3)`, [
      email,
      code,
      expiresAt
    ]);

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
    const profileResult = normalizeProfilePayload(payload);

    if (!email) {
      return { status: 400, body: { error: "이메일을 입력해주세요." } };
    }
    if (!password) {
      return { status: 400, body: { error: "비밀번호를 입력해주세요." } };
    }
    if (!code) {
      return { status: 400, body: { error: "이메일 인증 코드를 입력해주세요." } };
    }
    if (!profileResult.ok) {
      return { status: 400, body: { error: profileResult.error } };
    }

    const policyError = passwordPolicy(password);
    if (policyError) {
      return { status: 400, body: { error: policyError } };
    }

    return db.withTransaction(async (client) => {
      const existing = await getUserByEmail(email, client);
      if (existing) {
        return { status: 409, body: { error: "이미 가입된 이메일입니다." } };
      }

      const codeResult = await client.query<{ id: string }>(
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

      const passwordHash = await hashPassword(password);
      const created = await client.query<Pick<StoredUserRow, "id" | "email">>(
        `INSERT INTO auth_users (email, password_hash, email_verified)
         VALUES ($1, $2, TRUE)
         RETURNING id, email`,
        [email, passwordHash]
      );

      await client.query(
        `INSERT INTO user_profiles (user_id, display_name, birth_date, gender, nationality)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          created.rows[0].id,
          profileResult.value.name,
          profileResult.value.birthDate,
          profileResult.value.gender,
          profileResult.value.nationality
        ]
      );

      await client.query(`UPDATE email_verification_codes SET used_at = NOW() WHERE id = $1`, [codeResult.rows[0].id]);

      return {
        status: 201,
        body: {
          ...buildTokenResponse(created.rows[0], createPublicUserProfile(profileResult.value)),
          message: "가입이 완료되었습니다."
        }
      };
    });
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
        ...buildTokenResponse(user, toPublicUserProfile(user)),
        message: "Login successful."
      }
    };
  }

  async function getUserProfileById(userId: number): Promise<PublicUserProfile | null> {
    return getUserProfile(userId);
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
    getUserProfile: getUserProfileById,
    verifyToken: verifyTokenValue,
    close: () => db.close()
  };
}
