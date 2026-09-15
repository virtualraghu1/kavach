export const GENERIC_SIGN_IN_ERROR =
  "Unable to sign in. Check your details and try again.";

export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 4 || normalized.length > 254) return null;
  return normalized;
}

export function normalizeUsername(value: unknown): string | null {
  const normalized = normalizeIdentifier(value);
  return normalized && /^[a-z][a-z0-9._-]{3,31}$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeSetupCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "");
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

export function passwordPolicyError(value: unknown): string | null {
  if (typeof value !== "string") return "Enter your password.";
  if (value.length < 6) {
    return "Use at least 6 characters.";
  }
  if (value.length > 128) return "Use no more than 128 characters.";
  return null;
}

export function secureNumericCode(
  randomValues: (values: Uint32Array) => Uint32Array = (values) =>
    crypto.getRandomValues(values),
) {
  const range = 1_000_000;
  const maximum = 0x1_0000_0000;
  const unbiasedLimit = Math.floor(maximum / range) * range;
  const values = new Uint32Array(1);
  do {
    randomValues(values);
  } while (values[0] >= unbiasedLimit);
  return String(values[0] % range).padStart(6, "0");
}

export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("cf-connecting-ip") || "unknown";
}

export function jwtSessionId(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const value = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof value.session_id === "string" ? value.session_id : null;
  } catch {
    return null;
  }
}

export function textInput(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hmacDigest(
  pepper: string,
  context: string,
  value: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${context}:${value}`),
  );
  return `\\x${toHex(new Uint8Array(digest))}`;
}

export async function hmacBucket(
  pepper: string,
  dimension: "identifier" | "network",
  value: string,
): Promise<string> {
  return hmacDigest(pepper, dimension, value);
}

export function allowedOrigin(
  origin: string | null,
  configured: string,
): string | null {
  if (!origin) return null;
  const allowed = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}
