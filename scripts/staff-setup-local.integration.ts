import { createClient } from "npm:@supabase/supabase-js@2.116.0";

type Environment = { get(name: string): string | undefined };

function required(env: Environment, name: string) {
  const value = env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function api(
  url: string,
  publishableKey: string,
  origin: string,
  body: Record<string, unknown>,
  accessToken?: string,
) {
  const response = await fetch(`${url}/functions/v1/account-api`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "content-type": "application/json",
      origin,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload } as {
    status: number;
    payload: Record<string, unknown>;
  };
}

export async function runLocalStaffSetup(env: Environment) {
  const supabaseUrl = required(env, "SUPABASE_URL");
  const publishableKey = required(env, "SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = required(env, "SUPABASE_SERVICE_ROLE_KEY");
  const origin = required(env, "KAVACH_TEST_ORIGIN");
  const parsed = new URL(supabaseUrl);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("This integration test is locked to local Supabase.");
  }

  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerUsername = `owner.${suffix}`;
  const staffUsername = `meena.${suffix}`;
  const ownerPassword = "local-owner-password";
  const staffPassword = "local-staff-password";
  const internalOwnerEmail =
    `owner-${crypto.randomUUID()}@accounts.kavach.invalid`;
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ownerAuth, error: ownerAuthError } = await service.auth.admin
    .createUser({
      email: internalOwnerEmail,
      password: ownerPassword,
      email_confirm: true,
      app_metadata: { kavach_internal_identity: true },
    });
  assert(
    ownerAuth.user && !ownerAuthError,
    "Could not create local owner Auth user.",
  );

  const { data: ownerLink, error: ownerLinkError } = await service.rpc(
    "server_bootstrap_first_owner",
    {
      p_operation_id: crypto.randomUUID(),
      p_auth_user_id: ownerAuth.user.id,
      p_username: ownerUsername,
      p_verified_email: null,
    },
  );
  assert(
    !ownerLinkError && Array.isArray(ownerLink) && ownerLink[0],
    "Could not bootstrap local owner.",
  );

  const ownerSignIn = await api(
    supabaseUrl,
    publishableKey,
    origin,
    { action: "sign_in", identifier: ownerUsername, password: ownerPassword },
  );
  const ownerSession = ownerSignIn.payload.session as
    | { access_token?: string }
    | undefined;
  assert(
    ownerSignIn.status === 200 && ownerSession?.access_token,
    "Local owner could not sign in.",
  );

  const secondCommunity = await api(
    supabaseUrl,
    publishableKey,
    origin,
    {
      action: "create_community",
      displayName: "Local Test Community",
      slug: `local-test-${suffix}`,
      officeContactText: "Local integration test only.",
    },
    ownerSession.access_token,
  );
  assert(
    secondCommunity.status === 200,
    "Second community fixture was not created.",
  );

  const created = await api(
    supabaseUrl,
    publishableKey,
    origin,
    {
      action: "create_staff_setup",
      displayName: "Meena Rao",
      username: staffUsername,
      communityId: "00000000-0000-4000-8000-000000000001",
    },
    ownerSession.access_token,
  );
  const setup = created.payload.setup as
    | { accountId?: string; code?: string; username?: string }
    | undefined;
  assert(
    created.status === 200 && setup?.accountId &&
      /^\d{6}$/.test(setup.code ?? ""),
    `Owner could not issue a staff setup code (${created.status}: ${
      String(created.payload.error ?? "unknown")
    }).`,
  );

  const duplicate = await api(
    supabaseUrl,
    publishableKey,
    origin,
    {
      action: "create_staff_setup",
      displayName: "Duplicate Meena",
      username: staffUsername.toUpperCase(),
      communityId: "00000000-0000-4000-8000-000000000001",
    },
    ownerSession.access_token,
  );
  assert(
    duplicate.status === 409,
    "Case-variant duplicate username was accepted.",
  );

  const prematureSignIn = await api(
    supabaseUrl,
    publishableKey,
    origin,
    { action: "sign_in", identifier: staffUsername, password: staffPassword },
  );
  assert(
    prematureSignIn.status === 401,
    "Pending staff signed in before setup.",
  );

  const regenerated = await api(
    supabaseUrl,
    publishableKey,
    origin,
    { action: "regenerate_staff_setup", accountId: setup.accountId },
    ownerSession.access_token,
  );
  const replacementSetup = regenerated.payload.setup as
    | { accountId?: string; code?: string }
    | undefined;
  assert(
    regenerated.status === 200 &&
      replacementSetup?.accountId === setup.accountId &&
      /^\d{6}$/.test(replacementSetup.code ?? ""),
    "Owner could not regenerate the setup code.",
  );

  const rejected = await api(supabaseUrl, publishableKey, origin, {
    action: "complete_account_setup",
    username: staffUsername,
    code: setup.code,
    password: staffPassword,
  });
  assert(rejected.status === 400, "The revoked setup code was not rejected.");

  const concurrent = await Promise.all([
    api(supabaseUrl, publishableKey, origin, {
      action: "complete_account_setup",
      username: staffUsername,
      code: replacementSetup.code,
      password: staffPassword,
    }),
    api(supabaseUrl, publishableKey, origin, {
      action: "complete_account_setup",
      username: staffUsername,
      code: replacementSetup.code,
      password: staffPassword,
    }),
  ]);
  assert(
    concurrent.filter((result) => result.status === 200).length === 1 &&
      concurrent.filter((result) => result.status === 409).length === 1,
    "Concurrent setup redemption did not resolve exactly once.",
  );

  const replay = await api(supabaseUrl, publishableKey, origin, {
    action: "complete_account_setup",
    username: staffUsername,
    code: replacementSetup.code,
    password: staffPassword,
  });
  assert(replay.status === 409, "A consumed setup code was not rejected.");

  const staffSignIn = await api(
    supabaseUrl,
    publishableKey,
    origin,
    { action: "sign_in", identifier: staffUsername, password: staffPassword },
  );
  const staffSession = staffSignIn.payload.session as
    | { access_token?: string }
    | undefined;
  assert(
    staffSignIn.status === 200 && staffSession?.access_token,
    "Staff could not sign in after setup.",
  );

  const workspace = await api(
    supabaseUrl,
    publishableKey,
    origin,
    { action: "workspace" },
    staffSession.access_token,
  );
  const staffWorkspace = workspace.payload.workspace as
    | {
      account?: { status?: string };
      roles?: Array<{ role?: string; communityId?: string }>;
      communities?: Array<{ id?: string }>;
    }
    | undefined;
  assert(workspace.status === 200, "Staff workspace could not be loaded.");
  assert(
    staffWorkspace?.account?.status === "active",
    "Staff was not activated.",
  );
  assert(
    staffWorkspace.roles?.length === 1 &&
      staffWorkspace.roles[0].role === "community_staff" &&
      staffWorkspace.communities?.length === 1,
    "Staff community boundary is incorrect.",
  );

  const { data: grantRows, error: grantsError } = await service.rpc(
    "server_staff_setup_grant_status",
    { p_account_link_id: setup.accountId },
  );
  assert(
    !grantsError && grantRows?.length === 1,
    "Grant audit row is missing.",
  );
  assert(
    grantRows[0].state === "consumed" &&
      grantRows[0].incorrect_attempts === 1 &&
      grantRows[0].digest_present,
    "Grant lifecycle was not persisted correctly.",
  );

  const blockedUsername = `anitha.${suffix}`;
  const blockedSetupResult = await api(
    supabaseUrl,
    publishableKey,
    origin,
    {
      action: "create_staff_setup",
      displayName: "Anitha Reddy",
      username: blockedUsername,
      communityId: "00000000-0000-4000-8000-000000000001",
    },
    ownerSession.access_token,
  );
  const blockedSetup = blockedSetupResult.payload.setup as
    | { accountId?: string; code?: string }
    | undefined;
  assert(
    blockedSetupResult.status === 200 && blockedSetup?.accountId,
    "Attempt-limit staff fixture was not created.",
  );
  const wrongCode = blockedSetup.code === "000000" ? "999999" : "000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await api(supabaseUrl, publishableKey, origin, {
      action: "complete_account_setup",
      username: blockedUsername,
      code: wrongCode,
      password: staffPassword,
    });
    assert(
      result.status === 400,
      "Incorrect-code attempt did not fail safely.",
    );
  }
  const blockedCorrectCode = await api(supabaseUrl, publishableKey, origin, {
    action: "complete_account_setup",
    username: blockedUsername,
    code: blockedSetup.code,
    password: staffPassword,
  });
  assert(
    blockedCorrectCode.status === 429,
    "Five-attempt limit was not enforced.",
  );
  const { data: blockedGrantRows, error: blockedGrantError } = await service
    .rpc(
      "server_staff_setup_grant_status",
      { p_account_link_id: blockedSetup.accountId },
    );
  assert(
    !blockedGrantError &&
      blockedGrantRows?.[0]?.state === "blocked" &&
      blockedGrantRows[0].incorrect_attempts === 5,
    "Blocked grant state was not persisted.",
  );

  return {
    ownerSignedIn: true,
    setupIssued: true,
    prematureSignInBlocked: true,
    duplicateUsernameRejected: true,
    regeneratedCodeRevokedPrevious: true,
    concurrentRedemptionResolvedOnce: true,
    consumedCodeRejected: true,
    fiveAttemptLimitEnforced: true,
    staffActivated: true,
    communityBoundaryVerified: true,
  };
}

if (import.meta.main) {
  const result = await runLocalStaffSetup(Deno.env);
  console.log(JSON.stringify(result));
}
