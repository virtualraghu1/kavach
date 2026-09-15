import {
  allowedOrigin,
  clientAddress,
  hmacBucket,
  hmacDigest,
  jwtSessionId,
  normalizeIdentifier,
  normalizeSetupCode,
  normalizeUsername,
  passwordPolicyError,
  secureNumericCode,
  textInput,
} from "./core.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("normalizes usernames and emails without touching passwords", () => {
  assert(normalizeIdentifier("  Lakshmi.R  ") === "lakshmi.r");
  assert(normalizeIdentifier("A") === null);
  assert(passwordPolicyError(" untrimmed passphrase ") === null);
  assert(passwordPolicyError("short") !== null);
  assert(passwordPolicyError("sixsix") === null);
  assert(normalizeUsername("  Meena.Rao  ") === "meena.rao");
  assert(normalizeUsername("meena@example.com") === null);
  assert(normalizeSetupCode("481 629") === "481629");
  assert(normalizeSetupCode("48162") === null);
});

Deno.test("generates a six-digit setup code without modulo bias", () => {
  const values = [4_294_000_000, 42];
  const code = secureNumericCode((target) => {
    target[0] = values.shift() ?? 0;
    return target;
  });
  assert(code === "000042");
});

Deno.test("uses the first trusted forwarded client address", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  assert(clientAddress(headers) === "203.0.113.7");
});

Deno.test("requires an exact configured browser origin", () => {
  const configured = "https://kavach.example, http://127.0.0.1:4173";
  assert(allowedOrigin("https://kavach.example", configured) !== null);
  assert(allowedOrigin("https://attacker.example", configured) === null);
  assert(allowedOrigin(null, configured) === null);
});

Deno.test("creates stable, separated, non-plain-text rate-limit buckets", async () => {
  const first = await hmacBucket("test-pepper", "identifier", "lakshmi.r");
  const again = await hmacBucket("test-pepper", "identifier", "lakshmi.r");
  const network = await hmacBucket("test-pepper", "network", "lakshmi.r");
  assert(first === again);
  assert(first !== network);
  assert(!first.includes("lakshmi"));
  assert(/^\\x[0-9a-f]{64}$/.test(first));
});

Deno.test("binds grant digests to their purpose and username", async () => {
  const first = await hmacDigest(
    "grant-pepper",
    "setup:meena.rao",
    "481629",
  );
  const otherUser = await hmacDigest(
    "grant-pepper",
    "setup:anitha.reddy",
    "481629",
  );
  assert(first !== otherUser);
  assert(!first.includes("481629"));
});

Deno.test("reads only a valid session id claim from a JWT payload", () => {
  const payload = btoa(JSON.stringify({ session_id: "session-123" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  assert(jwtSessionId(`header.${payload}.signature`) === "session-123");
  assert(jwtSessionId("not-a-jwt") === null);
});

Deno.test("normalizes bounded management text", () => {
  assert(textInput("  HIG BHEL  ", 3, 160) === "HIG BHEL");
  assert(textInput("x", 3, 160) === null);
  assert(textInput(42, 3, 160) === null);
});
