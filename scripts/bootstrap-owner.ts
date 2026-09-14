import { createClient } from "npm:@supabase/supabase-js@2.116.0";

export const PRODUCTION_PROJECT_REF = "ldexvxjccihecrclirof";
const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{3,31}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BootstrapConfig = {
  projectRef: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  authUserId: string;
  username: string;
  verifiedEmail: string | null;
  operationId: string;
};

type Environment = { get(name: string): string | undefined };

function required(env: Environment, name: string): string {
  const value = env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readBootstrapConfig(env: Environment): BootstrapConfig {
  const projectRef = required(env, "KAVACH_BOOTSTRAP_PROJECT_REF").trim();
  const supabaseUrl = required(env, "KAVACH_BOOTSTRAP_SUPABASE_URL").trim();
  const serviceRoleKey = required(
    env,
    "KAVACH_BOOTSTRAP_SERVICE_ROLE_KEY",
  );
  const authUserId = required(env, "KAVACH_OWNER_AUTH_USER_ID").trim();
  const username = required(env, "KAVACH_OWNER_USERNAME")
    .trim()
    .toLowerCase();
  const operationId = required(env, "KAVACH_BOOTSTRAP_OPERATION_ID").trim();
  const confirmation = required(env, "KAVACH_BOOTSTRAP_CONFIRM");
  const verifiedEmail = env.get("KAVACH_OWNER_VERIFIED_EMAIL")?.trim()
    .toLowerCase() || null;

  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("Invalid project ref.");
  if (!UUID_PATTERN.test(authUserId) || !UUID_PATTERN.test(operationId)) {
    throw new Error("Auth user ID and operation ID must be UUIDs.");
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(
      "Username must start with a letter and use 4–32 lowercase letters, numbers, dots, underscores or hyphens.",
    );
  }
  if (verifiedEmail?.endsWith(".invalid")) {
    throw new Error(
      "An internal alias cannot be recorded as a verified email.",
    );
  }

  const parsedUrl = new URL(supabaseUrl);
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== `${projectRef}.supabase.co`
  ) {
    throw new Error("Supabase URL does not match the confirmed project ref.");
  }

  const expectedConfirmation = `BOOTSTRAP OWNER ${projectRef} ${authUserId}`;
  if (confirmation !== expectedConfirmation) {
    throw new Error("Bootstrap confirmation does not match the exact target.");
  }
  if (
    projectRef === PRODUCTION_PROJECT_REF &&
    env.get("KAVACH_ALLOW_PRODUCTION_BOOTSTRAP") !== "YES"
  ) {
    throw new Error(
      "Production bootstrap is locked. Use staging, or explicitly authorize the production gate.",
    );
  }

  return {
    projectRef,
    supabaseUrl,
    serviceRoleKey,
    authUserId,
    username,
    verifiedEmail,
    operationId,
  };
}

export async function bootstrapOwner(config: BootstrapConfig) {
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authResult, error: authError } = await admin.auth.admin
    .getUserById(config.authUserId);
  if (authError || !authResult.user?.email) {
    throw new Error("The exact Auth user could not be verified.");
  }
  if (
    config.verifiedEmail &&
    authResult.user.email.toLowerCase() !== config.verifiedEmail
  ) {
    throw new Error("Verified email does not match the exact Auth user.");
  }

  const { data, error } = await admin.rpc("server_bootstrap_first_owner", {
    p_operation_id: config.operationId,
    p_auth_user_id: config.authUserId,
    p_username: config.username,
    p_verified_email: config.verifiedEmail,
  });
  const result =
    (data as Array<{ account_link_id: string; created: boolean }> | null)
      ?.[0];
  if (error || !result) throw new Error("Owner bootstrap did not complete.");
  return result;
}

if (import.meta.main) {
  try {
    const config = readBootstrapConfig(Deno.env);
    const result = await bootstrapOwner(config);
    console.log(
      JSON.stringify({
        projectRef: config.projectRef,
        authUserId: config.authUserId,
        accountLinkId: result.account_link_id,
        created: result.created,
      }),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Owner bootstrap failed.",
    );
    Deno.exit(1);
  }
}
