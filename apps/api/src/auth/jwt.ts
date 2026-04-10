import crypto from "node:crypto";

export interface TokenUser {
  id: number | string;
  email: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  type: "access";
}

interface JwtOptions {
  secret: string;
  issuer: string;
  audience: string;
  expiresInSeconds: number;
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function signHmacSha256(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function encodeJson(value: unknown): string {
  return base64url(JSON.stringify(value));
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function signJwt(payload: JwtPayload, options: JwtOptions): string {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const unsigned = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = signHmacSha256(unsigned, options.secret);
  return `${unsigned}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const [headerPart, payloadPart, signaturePart] = String(token || "").split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Invalid token format.");
  }

  const unsigned = `${headerPart}.${payloadPart}`;
  const expected = decodeBase64Url(signHmacSha256(unsigned, secret));
  const actual = decodeBase64Url(signaturePart);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("Invalid token signature.");
  }

  const payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8")) as JwtPayload;
  if (payload.exp * 1000 < Date.now()) {
    throw new Error("Token expired.");
  }
  return payload;
}

export function buildAccessToken(user: TokenUser, options: JwtOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + options.expiresInSeconds;
  return signJwt(
    {
      sub: String(user.id),
      email: user.email,
      iat: now,
      exp,
      iss: options.issuer,
      aud: options.audience,
      type: "access"
    },
    options
  );
}
