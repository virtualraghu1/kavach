import {
  PRODUCTION_PROJECT_REF,
  readBootstrapConfig,
} from "./bootstrap-owner.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

const authUserId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const stagingRef = "abcdefghijklmnopqrst";

function environment(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    KAVACH_BOOTSTRAP_PROJECT_REF: stagingRef,
    KAVACH_BOOTSTRAP_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
    KAVACH_BOOTSTRAP_SERVICE_ROLE_KEY: "test-service-key",
    KAVACH_OWNER_AUTH_USER_ID: authUserId,
    KAVACH_OWNER_USERNAME: "  Kavach.Owner  ",
    KAVACH_BOOTSTRAP_OPERATION_ID: operationId,
    KAVACH_BOOTSTRAP_CONFIRM: `BOOTSTRAP OWNER ${stagingRef} ${authUserId}`,
    ...overrides,
  };
  return { get: (name: string) => values[name] };
}

Deno.test("normalizes a valid staging owner target", () => {
  const config = readBootstrapConfig(environment());
  assert(config.username === "kavach.owner");
  assert(config.verifiedEmail === null);
});

Deno.test("requires an exact project and Auth-user confirmation", () => {
  let rejected = false;
  try {
    readBootstrapConfig(environment({ KAVACH_BOOTSTRAP_CONFIRM: "YES" }));
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("locks the production project unless separately enabled", () => {
  let rejected = false;
  try {
    readBootstrapConfig(environment({
      KAVACH_BOOTSTRAP_PROJECT_REF: PRODUCTION_PROJECT_REF,
      KAVACH_BOOTSTRAP_SUPABASE_URL:
        `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      KAVACH_BOOTSTRAP_CONFIRM:
        `BOOTSTRAP OWNER ${PRODUCTION_PROJECT_REF} ${authUserId}`,
    }));
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("requires both production opt-in and exact target confirmation", () => {
  const config = readBootstrapConfig(environment({
    KAVACH_BOOTSTRAP_PROJECT_REF: PRODUCTION_PROJECT_REF,
    KAVACH_BOOTSTRAP_SUPABASE_URL:
      `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    KAVACH_BOOTSTRAP_CONFIRM:
      `BOOTSTRAP OWNER ${PRODUCTION_PROJECT_REF} ${authUserId}`,
    KAVACH_ALLOW_PRODUCTION_BOOTSTRAP: "YES",
  }));
  assert(config.projectRef === PRODUCTION_PROJECT_REF);
});

Deno.test("rejects mismatched URLs and internal aliases as verified email", () => {
  const invalidCases: Array<Record<string, string>> = [
    { KAVACH_BOOTSTRAP_SUPABASE_URL: "https://wrong.supabase.co" },
    { KAVACH_OWNER_VERIFIED_EMAIL: "owner@accounts.kavach.invalid" },
  ];
  for (const overrides of invalidCases) {
    let rejected = false;
    try {
      readBootstrapConfig(environment(overrides));
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
