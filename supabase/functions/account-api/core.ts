export const GENERIC_SIGN_IN_ERROR =
  "Unable to sign in. Check your details and try again.";

export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 4 || normalized.length > 254) return null;
  return normalized;
}

export function passwordPolicyError(value: unknown): string | null {
  if (typeof value !== "string") return "Enter your password.";
  if (value.length < 12) {
    return "Use at least 12 characters. A memorable passphrase is welcome.";
  }
  if (value.length > 128) return "Use no more than 128 characters.";
  return null;
}

export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("cf-connecting-ip") || "unknown";
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function hmacBucket(
  pepper: string,
  dimension: "identifier" | "network",
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
    encoder.encode(`${dimension}:${value}`),
  );
  return `\\x${toHex(new Uint8Array(digest))}`;
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
