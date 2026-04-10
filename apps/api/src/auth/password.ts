import crypto from "node:crypto";

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const ITERATIONS = 210_000;
const DIGEST = "sha256";
const MIN_PASSWORD_LENGTH = 9;
const LETTER_PATTERN = /[A-Za-z]/;
const NUMBER_PATTERN = /\d/;
const SPECIAL_PATTERN = /[!-/:-@[-`{-~]/;

export const PASSWORD_POLICY_MESSAGE =
  "비밀번호는 9자 이상이며 영문, 숫자, 특수문자를 모두 포함해야 합니다.";

export function normalizeEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

export function passwordPolicy(password: unknown): string | null {
  const value = String(password ?? "");
  if (
    value.length < MIN_PASSWORD_LENGTH ||
    !LETTER_PATTERN.test(value) ||
    !NUMBER_PATTERN.test(value) ||
    !SPECIAL_PATTERN.test(value)
  ) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });

  return [
    "pbkdf2",
    DIGEST,
    String(ITERATIONS),
    salt.toString("base64"),
    derivedKey.toString("base64")
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [scheme, digest, iterationsRaw, saltBase64, hashBase64] = encodedHash.split("$");
  if (!scheme || scheme !== "pbkdf2" || !digest || !iterationsRaw || !saltBase64 || !hashBase64) {
    return false;
  }

  const iterations = Number.parseInt(iterationsRaw, 10);
  const salt = Buffer.from(saltBase64, "base64");
  const expected = Buffer.from(hashBase64, "base64");
  const actual = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, expected.length, digest, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}
