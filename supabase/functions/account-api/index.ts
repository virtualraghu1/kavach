import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  allowedOrigin,
  clientAddress,
  GENERIC_SIGN_IN_ERROR,
  hmacBucket,
  jwtSessionId,
  normalizeIdentifier,
  textInput,
} from "./core.ts";

type LoginResolution = {
  account_link_id: string;
  auth_user_id: string;
  auth_email: string;
  account_kind: "owner" | "staff" | "resident";
  account_status: "pending" | "active" | "disabled";
};

type AuthenticatedAccount = {
  account_link_id: string;
  account_kind: "owner" | "staff" | "resident";
  account_status: "active";
  display_name: string | null;
  auth_user_id: string;
};

type RoleRow = {
  role: "owner" | "community_staff" | "resident";
  community_id: string | null;
};

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};
type RpcCall = (
  functionName: string,
  parameters?: Record<string, unknown>,
) => PromiseLike<RpcResult>;

const noStoreHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "content-type": "application/json; charset=utf-8",
  vary: "Origin",
};

function response(
  body: Record<string, unknown> | null,
  status: number,
  origin: string | null,
) {
  const headers = new Headers(noStoreHeaders);
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set(
      "access-control-allow-headers",
      "authorization, apikey, content-type",
    );
    headers.set("access-control-allow-methods", "POST, OPTIONS");
  }
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

async function consumeRateLimit(
  rpc: RpcCall,
  bucket: string,
  action: string,
  limit: number,
) {
  const { data, error } = await rpc("server_consume_rate_limit", {
    p_action: action,
    p_block_seconds: 900,
    p_bucket_key: bucket,
    p_limit: limit,
    p_window_seconds: 900,
  });
  const rows = data as
    | Array<{ allowed: boolean; retry_after_seconds: number }>
    | null;
  if (error || !rows?.[0]) throw new Error("rate_limit_unavailable");
  return rows[0];
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

async function authenticate(
  request: Request,
  publicClient: SupabaseClient,
  service: SupabaseClient,
): Promise<AuthenticatedAccount | null> {
  const token = bearerToken(request);
  const sessionId = token ? jwtSessionId(token) : null;
  if (!token || !sessionId) return null;

  const { data, error } = await publicClient.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: validated, error: validationError } = await service.rpc(
    "server_validate_session",
    { p_auth_user_id: data.user.id, p_session_id: sessionId },
  );
  const account = (
    validated as Omit<AuthenticatedAccount, "auth_user_id">[] | null
  )?.[0];
  if (validationError || !account) return null;
  return { ...account, auth_user_id: data.user.id };
}

async function getRoles(service: SupabaseClient, accountId: string) {
  const { data, error } = await service
    .from("role_assignments")
    .select("role, community_id")
    .eq("account_link_id", accountId)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []) as RoleRow[];
}

function hasOwnerRole(roles: RoleRow[]) {
  return roles.some((assignment) => assignment.role === "owner");
}

async function usernamesFor(service: SupabaseClient, accountIds: string[]) {
  if (!accountIds.length) return new Map<string, string>();
  const { data, error } = await service.rpc("server_account_usernames", {
    p_account_ids: accountIds,
  });
  if (error) throw error;
  return new Map(
    ((data ?? []) as Array<{ account_link_id: string; username: string }>).map(
      (row) => [row.account_link_id, row.username],
    ),
  );
}

async function workspaceFor(
  service: SupabaseClient,
  account: AuthenticatedAccount,
) {
  const roles = await getRoles(service, account.account_link_id);
  const owner = hasOwnerRole(roles);
  const assignedCommunityIds = roles
    .filter((assignment) => assignment.community_id)
    .map((assignment) => assignment.community_id as string);

  let communitiesQuery = service
    .from("communities")
    .select("id, slug, display_name, office_contact_text, timezone, active")
    .order("display_name");
  if (!owner) {
    communitiesQuery = communitiesQuery.in(
      "id",
      assignedCommunityIds.length
        ? assignedCommunityIds
        : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  const { data: communityRows, error: communitiesError } =
    await communitiesQuery;
  if (communitiesError) throw communitiesError;
  const visibleCommunityRows = owner
    ? (communityRows ?? [])
    : (communityRows ?? []).filter((community) => community.active);
  const visibleCommunityIds = visibleCommunityRows.map(
    (community) => community.id as string,
  );

  let residentsQuery = service
    .from("residents")
    .select(
      "id, community_id, full_name, house_number, block, category, preferred_language, membership_state, created_at",
    )
    .order("full_name");
  if (account.account_kind === "resident") {
    const { data: ownLink, error: ownLinkError } = await service
      .from("account_links")
      .select("resident_id")
      .eq("id", account.account_link_id)
      .single();
    if (ownLinkError || !ownLink?.resident_id) {
      throw new Error("resident_link_missing");
    }
    residentsQuery = residentsQuery
      .eq("id", ownLink.resident_id)
      .in(
        "community_id",
        visibleCommunityIds.length
          ? visibleCommunityIds
          : ["00000000-0000-0000-0000-000000000000"],
      );
  } else if (!owner) {
    residentsQuery = residentsQuery.in(
      "community_id",
      visibleCommunityIds.length
        ? visibleCommunityIds
        : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  const { data: residentRows, error: residentsError } = await residentsQuery;
  if (residentsError) throw residentsError;

  const residentIds = (residentRows ?? []).map((row) => row.id as string);
  const [membershipsResult, verificationsResult, consentsResult, linksResult] =
    residentIds.length
      ? await Promise.all([
        service
          .from("memberships")
          .select("id, resident_id, community_id, status")
          .in("resident_id", residentIds),
        service
          .from("verification_records")
          .select("resident_id, membership_id, valid, verified_at")
          .in("resident_id", residentIds)
          .eq("valid", true),
        service
          .from("consent_records")
          .select("resident_id, membership_id, granted, withdrawn_at")
          .in("resident_id", residentIds)
          .eq("consent_type", "enrollment")
          .eq("granted", true),
        service
          .from("account_links")
          .select("id, resident_id, status, activated_at")
          .in("resident_id", residentIds),
      ])
      : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  const relatedError = [
    membershipsResult,
    verificationsResult,
    consentsResult,
    linksResult,
  ].find((result) => result.error)?.error;
  if (relatedError) throw relatedError;

  const memberships = membershipsResult.data ?? [];
  const verifications = verificationsResult.data ?? [];
  const consents = consentsResult.data ?? [];
  const links = linksResult.data ?? [];
  const residents = (residentRows ?? []).map((resident) => {
    const membership = memberships.find(
      (row) => row.resident_id === resident.id,
    );
    const accountLink = links.find((row) => row.resident_id === resident.id);
    return {
      id: resident.id,
      communityId: resident.community_id,
      fullName: resident.full_name,
      houseNumber: resident.house_number,
      block: resident.block,
      category: resident.category,
      preferredLanguage: resident.preferred_language,
      profileStatus: resident.membership_state,
      membershipStatus: membership?.status ?? "draft",
      verified: Boolean(
        membership &&
          verifications.some((row) => row.membership_id === membership.id),
      ),
      consentRecorded: Boolean(
        membership &&
          consents.some(
            (row) => row.membership_id === membership.id && !row.withdrawn_at,
          ),
      ),
      accountStatus: accountLink?.status ?? "not_created",
      activatedAt: accountLink?.activated_at ?? null,
      createdAt: resident.created_at,
    };
  });

  let staff: Array<Record<string, unknown>> = [];
  if (owner) {
    const { data: staffRoles, error: staffRolesError } = await service
      .from("role_assignments")
      .select("account_link_id, community_id, role, active, granted_at")
      .eq("role", "community_staff")
      .order("granted_at");
    if (staffRolesError) throw staffRolesError;
    const staffIds = [
      ...new Set(
        (staffRoles ?? []).map((row) => row.account_link_id as string),
      ),
    ];
    const { data: staffAccounts, error: staffAccountsError } = staffIds.length
      ? await service
        .from("account_links")
        .select("id, status, display_name, activated_at")
        .in("id", staffIds)
      : { data: [], error: null };
    if (staffAccountsError) throw staffAccountsError;
    const usernames = await usernamesFor(service, staffIds);
    staff = (staffAccounts ?? []).map((staffAccount) => ({
      accountId: staffAccount.id,
      username: usernames.get(staffAccount.id as string) ??
        "Username unavailable",
      displayName: staffAccount.display_name ??
        usernames.get(staffAccount.id as string) ??
        "Society administrator",
      status: staffAccount.status,
      activatedAt: staffAccount.activated_at,
      assignments: (staffRoles ?? [])
        .filter((row) => row.account_link_id === staffAccount.id)
        .map((row) => ({
          communityId: row.community_id,
          active: row.active,
        })),
    }));
  }

  const ownUsername = await usernamesFor(service, [account.account_link_id]);
  const residentIdentity = residents.find(
    (resident) =>
      account.account_kind === "resident" &&
      resident.accountStatus !== "not_created",
  );
  return {
    account: {
      id: account.account_link_id,
      kind: account.account_kind,
      status: account.account_status,
      username: ownUsername.get(account.account_link_id) ?? "",
      displayName: account.display_name ??
        residentIdentity?.fullName ??
        ownUsername.get(account.account_link_id) ??
        "Kavach member",
    },
    roles: roles.map((role) => ({
      role: role.role,
      communityId: role.community_id,
    })),
    communities: visibleCommunityRows.map((community) => ({
      id: community.id,
      slug: community.slug,
      displayName: community.display_name,
      officeContactText: community.office_contact_text,
      timezone: community.timezone,
      active: community.active,
    })),
    residents,
    staff,
  };
}

async function ownerMutation(
  body: Record<string, unknown>,
  service: SupabaseClient,
  account: AuthenticatedAccount,
  roles: RoleRow[],
) {
  if (!hasOwnerRole(roles)) {
    return {
      status: 403,
      body: { error: "You do not have permission to do that." },
    };
  }

  if (body.action === "create_community") {
    const displayName = textInput(body.displayName, 3, 160);
    const slug = typeof body.slug === "string"
      ? body.slug.trim().toLowerCase()
      : "";
    const officeContactText = textInput(body.officeContactText, 3, 500);
    if (!displayName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return {
        status: 400,
        body: { error: "Enter a valid community name and URL name." },
      };
    }
    const { data, error } = await service
      .from("communities")
      .insert({
        display_name: displayName,
        slug,
        office_contact_text: officeContactText,
        timezone: "Asia/Kolkata",
      })
      .select("id, slug, display_name, office_contact_text, timezone, active")
      .single();
    if (error) {
      const duplicate = error.code === "23505";
      return {
        status: duplicate ? 409 : 400,
        body: {
          error: duplicate
            ? "That community URL name is already in use."
            : "The community could not be created.",
        },
      };
    }
    await service.from("security_events").insert({
      actor_account_id: account.account_link_id,
      community_id: data.id,
      event_type: "community_created",
      outcome: "success",
      details: {},
    });
    return { status: 200, body: { community: data } };
  }

  if (body.action === "set_community_status") {
    if (
      typeof body.communityId !== "string" ||
      typeof body.active !== "boolean"
    ) {
      return {
        status: 400,
        body: { error: "Invalid community update." },
      };
    }
    const { data, error } = await service
      .from("communities")
      .update({ active: body.active })
      .eq("id", body.communityId)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      return { status: 404, body: { error: "Community not found." } };
    }
    await service.from("security_events").insert({
      actor_account_id: account.account_link_id,
      community_id: body.communityId,
      event_type: body.active ? "community_enabled" : "community_disabled",
      outcome: "success",
      details: {},
    });
    return { status: 200, body: { updated: true } };
  }

  if (body.action === "set_staff_account_status") {
    if (
      typeof body.accountId !== "string" ||
      !["active", "disabled"].includes(String(body.status)) ||
      body.accountId === account.account_link_id
    ) {
      return {
        status: 400,
        body: { error: "Invalid staff account update." },
      };
    }
    const { data: targetRole, error: targetRoleError } = await service
      .from("role_assignments")
      .select("community_id")
      .eq("account_link_id", body.accountId)
      .eq("role", "community_staff")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (targetRoleError || !targetRole) {
      return {
        status: 404,
        body: { error: "Society administrator not found." },
      };
    }
    const status = body.status as "active" | "disabled";
    const update: Record<string, unknown> = { status };
    if (status === "disabled") update.revoked_before = new Date().toISOString();
    const { data, error } = await service
      .from("account_links")
      .update(update)
      .eq("id", body.accountId)
      .eq("account_kind", "staff")
      .select("id")
      .maybeSingle();
    if (error || !data) {
      return {
        status: 404,
        body: { error: "Society administrator not found." },
      };
    }
    await service.from("security_events").insert({
      actor_account_id: account.account_link_id,
      community_id: targetRole.community_id,
      event_type: status === "active"
        ? "staff_account_enabled"
        : "staff_account_disabled",
      outcome: "success",
      details: { target_account_id: body.accountId },
    });
    return { status: 200, body: { updated: true } };
  }

  return { status: 400, body: { error: "Unsupported action." } };
}

async function handleRequest(request: Request): Promise<Response> {
  const configuredOrigins = Deno.env.get("KAVACH_ALLOWED_ORIGINS") ?? "";
  const requestOrigin = request.headers.get("origin");
  const corsOrigin = allowedOrigin(requestOrigin, configuredOrigins);

  if (requestOrigin && !corsOrigin) {
    return response({ error: "Request origin is not allowed." }, 403, null);
  }
  if (request.method === "OPTIONS") return response(null, 204, corsOrigin);
  if (request.method !== "POST") {
    return response({ error: "Method not allowed." }, 405, corsOrigin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pepper = Deno.env.get("KAVACH_RATE_LIMIT_PEPPER");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey || !pepper) {
    return response({ error: "Service is not configured." }, 503, corsOrigin);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Invalid request." }, 400, corsOrigin);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rpc = service.rpc.bind(service) as unknown as RpcCall;

  if (body.action === "sign_in") {
    const identifier = normalizeIdentifier(body.identifier);
    const password = body.password;
    if (!identifier || typeof password !== "string") {
      return response({ error: GENERIC_SIGN_IN_ERROR }, 401, corsOrigin);
    }
    try {
      const [identifierLimit, networkLimit] = await Promise.all([
        consumeRateLimit(
          rpc,
          await hmacBucket(pepper, "identifier", identifier),
          "sign_in_identifier",
          10,
        ),
        consumeRateLimit(
          rpc,
          await hmacBucket(pepper, "network", clientAddress(request.headers)),
          "sign_in_network",
          50,
        ),
      ]);
      if (!identifierLimit.allowed || !networkLimit.allowed) {
        const retryAfter = Math.max(
          identifierLimit.retry_after_seconds,
          networkLimit.retry_after_seconds,
        );
        const limited = response(
          { error: "Too many attempts. Please wait and try again." },
          429,
          corsOrigin,
        );
        limited.headers.set("retry-after", String(retryAfter));
        return limited;
      }

      const { data: resolved, error: resolveError } = await rpc(
        "server_resolve_login",
        { p_identifier: identifier },
      );
      const login = (resolved as LoginResolution[] | null)?.[0];
      if (resolveError || !login || login.account_status === "disabled") {
        return response({ error: GENERIC_SIGN_IN_ERROR }, 401, corsOrigin);
      }

      const credentialClient = createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await credentialClient.auth.signInWithPassword({
        email: login.auth_email,
        password,
      });
      if (error || !data.session || data.user.id !== login.auth_user_id) {
        return response({ error: GENERIC_SIGN_IN_ERROR }, 401, corsOrigin);
      }

      const { data: acknowledgement, error: acknowledgementError } = await rpc(
        "server_acknowledge_sign_in",
        {
          p_auth_user_id: data.user.id,
        },
      );
      if (
        acknowledgementError ||
        !(acknowledgement as Array<Record<string, unknown>> | null)?.[0]
      ) {
        await credentialClient.auth.signOut({ scope: "local" });
        return response({ error: GENERIC_SIGN_IN_ERROR }, 401, corsOrigin);
      }

      return response(
        {
          session: {
            access_token: data.session.access_token,
            expires_at: data.session.expires_at,
            expires_in: data.session.expires_in,
            refresh_token: data.session.refresh_token,
            token_type: data.session.token_type,
          },
        },
        200,
        corsOrigin,
      );
    } catch {
      return response(
        { error: "Sign-in is temporarily unavailable. Please try again." },
        503,
        corsOrigin,
      );
    }
  }

  const account = await authenticate(request, publicClient, service);
  if (!account) {
    return response(
      { error: "Your session is no longer active. Please sign in again." },
      401,
      corsOrigin,
    );
  }

  try {
    if (body.action === "workspace") {
      return response(
        { workspace: await workspaceFor(service, account) },
        200,
        corsOrigin,
      );
    }
    const roles = await getRoles(service, account.account_link_id);
    const result = await ownerMutation(body, service, account, roles);
    return response(result.body, result.status, corsOrigin);
  } catch {
    return response(
      { error: "Kavach could not complete this request. Please try again." },
      503,
      corsOrigin,
    );
  }
}

export default { fetch: handleRequest };
export { handleRequest };
