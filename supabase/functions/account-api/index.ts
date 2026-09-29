import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  allowedOrigin,
  clientAddress,
  GENERIC_SIGN_IN_ERROR,
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

type StaffSetupGrant = {
  accountId: string;
  username: string;
  code: string;
  expiresAt: string;
  communityId: string;
};

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

function randomEnrollmentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enrollmentTokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function staffSetupMaterial(grantPepper: string, username: string) {
  const code = secureNumericCode();
  return {
    code,
    digest: await hmacDigest(
      grantPepper,
      `setup:${username}`,
      code,
    ),
    passwordOperationId: crypto.randomUUID(),
    grantId: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
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
    .is("deleted_at", null)
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
  } else {
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
      .in("community_id", visibleCommunityIds.length ? visibleCommunityIds : ["00000000-0000-0000-0000-000000000000"])
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

async function enrollResident(body: Record<string, unknown>, service: SupabaseClient, account: AuthenticatedAccount, roles: RoleRow[]) {
  if (body.action !== "enroll_resident") return null;
  const communityId = typeof body.communityId === "string" ? body.communityId : "";
  if (!hasOwnerRole(roles) && !roles.some((role) => role.role === "community_staff" && role.community_id === communityId)) {
    return { status: 403, body: { error: "You cannot add residents to this community." } };
  }
  const name = textInput(body.fullName, 2, 160);
  const house = textInput(body.houseNumber, 1, 40);
  const reason = textInput(body.verificationReason, 3, 500);
  if (!name || !house || !reason || body.verified !== true || body.consent !== true ||
      !["senior", "community_member"].includes(String(body.category)) ||
      typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId) ||
      !/^[0-9a-f-]{36}$/i.test(communityId) ||
      (body.block != null && (typeof body.block !== "string" || body.block.length > 80))) {
    return { status: 400, body: { error: "Enter resident details and confirm identity verification and enrollment consent." } };
  }
  const { data, error } = await service.rpc("server_enroll_resident", {
    p_request_id: body.requestId, p_actor: account.account_link_id,
    p_community_id: communityId, p_full_name: name, p_house_number: house,
    p_block: body.block || null, p_category: body.category, p_verified: true,
    p_consent: true, p_verification_reason: reason,
  });
  if (error) return { status: error.code === "42501" ? 403 : 409, body: { error: "Resident could not be added. Check the details and your community access." } };
  return { status: 200, body: { residentId: data } };
}

async function residentQrMutation(
  body: Record<string, unknown>,
  service: SupabaseClient,
  account: AuthenticatedAccount,
  roles: RoleRow[],
  grantPepper: string | null,
) {
  const action = body.action;
  if (!["create_resident_qr", "list_resident_qr_requests", "review_resident_qr_request"].includes(String(action))) return null;
  if (!hasOwnerRole(roles) && !roles.some((role) => role.role === "community_staff")) {
    return { status: 403, body: { error: "Only authorised community staff can manage enrollment." } };
  }
  const canManage = (communityId: string) => hasOwnerRole(roles) || roles.some((role) =>
    role.role === "community_staff" && role.community_id === communityId
  );

  if (action === "create_resident_qr") {
    const residentId = typeof body.residentId === "string" ? body.residentId : "";
    if (!/^[0-9a-f-]{36}$/i.test(residentId)) return { status: 400, body: { error: "Select a resident." } };
    const { data: resident, error } = await service.from("residents")
      .select("id, community_id, membership_state")
      .eq("id", residentId).maybeSingle();
    if (error) throw error;
    if (!resident || !canManage(resident.community_id)) return { status: 404, body: { error: "Resident not found in your community." } };
    if (resident.membership_state !== "active") return { status: 400, body: { error: "Activate this resident’s membership before issuing a QR." } };
    const { data: accountLink, error: accountError } = await service.from("account_links")
      .select("id").eq("resident_id", residentId).maybeSingle();
    if (accountError) throw accountError;
    if (accountLink) return { status: 409, body: { error: "This resident already has an account setup. Review that account instead." } };
    const { data: pending, error: pendingError } = await service.from("resident_qr_requests")
      .select("id").eq("resident_id", residentId).eq("state", "pending").maybeSingle();
    if (pendingError) throw pendingError;
    if (pending) return { status: 409, body: { error: "This resident already has a request awaiting review." } };
    const token = randomEnrollmentToken();
    const digest = await enrollmentTokenDigest(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await service.rpc("server_issue_resident_qr", {
      p_resident_id: residentId, p_actor: account.account_link_id,
      p_digest: digest, p_expires_at: expiresAt,
    });
    if (insertError) return { status: 409, body: { error: "The QR could not be issued. Refresh the resident’s account status and try again." } };
    return { status: 200, body: { qr: { token, expiresAt, residentId } } };
  }

  if (action === "list_resident_qr_requests") {
    let query = service.from("resident_qr_requests")
      .select("id, resident_id, requested_username, requested_at, residents!inner(community_id, full_name, house_number, communities!inner(deleted_at))")
      .eq("state", "pending").is("residents.communities.deleted_at", null);
    if (!hasOwnerRole(roles)) query = query.in("residents.community_id", roles
      .filter(role => role.role === "community_staff" && role.community_id)
      .map(role => role.community_id!));
    const { data, error } = await query.order("requested_at", { ascending: true }).limit(100);
    if (error) throw error;
    const requests = data as unknown as Array<{ id: string; resident_id: string; requested_username: string; requested_at: string; residents: { community_id: string; full_name: string; house_number: string } }>;
    return { status: 200, body: { requests: (requests ?? []).map(item => ({
      id: item.id, residentId: item.resident_id, username: item.requested_username,
      requestedAt: item.requested_at, fullName: item.residents.full_name,
      houseNumber: item.residents.house_number, communityId: item.residents.community_id,
    })) } };
  }

  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const decision = body.decision;
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || (decision !== "approve" && decision !== "reject")) {
    return { status: 400, body: { error: "Choose an enrollment request and decision." } };
  }
  const { data: pending, error: pendingError } = await service.from("resident_qr_requests")
    .select("id, resident_id, requested_username, state")
    .eq("id", requestId).maybeSingle();
  if (pendingError) throw pendingError;
  if (!pending || pending.state !== "pending") return { status: 409, body: { error: "This request is no longer pending." } };
  const { data: resident, error: residentError } = await service.from("residents")
    .select("id, community_id")
    .eq("id", pending.resident_id).maybeSingle();
  if (residentError) throw residentError;
  if (!resident || !canManage(resident.community_id)) return { status: 404, body: { error: "Resident not found in your community." } };
  if (decision === "reject") {
    const { data, error } = await service.from("resident_qr_requests")
      .update({ state: "rejected", reviewed_by: account.account_link_id, reviewed_at: new Date().toISOString() })
      .eq("id", requestId).eq("state", "pending").select("id").maybeSingle();
    if (error || !data) return { status: 409, body: { error: "This request could not be rejected." } };
    return { status: 200, body: { reviewed: true } };
  }
  if (!grantPepper) return { status: 503, body: { error: "Account setup is not configured." } };
  const setup = await residentSetupMutation({
    action: "create_resident_setup", residentId: resident.id, username: pending.requested_username,
  }, service, account, roles, grantPepper, pending.id);
  return setup;

}

async function residentSetupMutation(
  body: Record<string, unknown>,
  service: SupabaseClient,
  account: AuthenticatedAccount,
  roles: RoleRow[],
  grantPepper: string | null,
  qrRequestId?: string,
) {
  if (body.action !== "create_resident_setup" &&
    body.action !== "regenerate_resident_setup") return null;
  if (!grantPepper) return { status: 503, body: { error: "Account setup is not configured." } };
  const residentId = typeof body.residentId === "string" ? body.residentId : "";
  const requestedUsername = normalizeUsername(body.username);
  if (!/^[0-9a-f-]{36}$/i.test(residentId) ||
    (body.action === "create_resident_setup" && !requestedUsername)) {
    return { status: 400, body: { error: "Select a resident and enter a valid username." } };
  }
  const { data: resident, error: residentError } = await service
    .from("residents")
    .select("id, community_id, full_name, membership_state")
    .eq("id", residentId).maybeSingle();
  if (residentError) throw residentError;
  if (!resident || (!hasOwnerRole(roles) && !roles.some((role) =>
    role.role === "community_staff" && role.community_id === resident.community_id
  ))) return { status: 404, body: { error: "Resident not found in your community." } };
  if (resident.membership_state !== "active") {
    return { status: 400, body: { error: "This resident is not ready for account setup." } };
  }
  let username = requestedUsername;
  if (body.action === "regenerate_resident_setup") {
    const { data: link, error: linkError } = await service.from("account_links")
      .select("id").eq("resident_id", residentId).eq("account_kind", "resident")
      .eq("status", "pending").maybeSingle();
    if (linkError || !link) {
      return { status: 400, body: { error: "This resident has no pending setup." } };
    }
    username = (await usernamesFor(service, [link.id])).get(link.id) ?? null;
    if (!username) return { status: 503, body: { error: "Username unavailable." } };
    const material = await staffSetupMaterial(grantPepper, username);
    const { data, error } = await service.rpc("server_regenerate_resident_setup", {
      p_resident_id: residentId,
      p_password_operation_id: material.passwordOperationId,
      p_grant_id: material.grantId,
      p_code_digest: material.digest,
      p_expires_at: material.expiresAt,
      p_created_by: account.account_link_id,
    });
    const row = (data as Array<{ account_link_id: string }> | null)?.[0];
    if (error || !row) {
      return { status: 409, body: { error: "A new setup code could not be issued. Ask the office to review the account." } };
    }
    return { status: 200, body: { setup: {
      accountId: row.account_link_id, residentId, username,
      code: material.code, expiresAt: material.expiresAt,
      communityId: resident.community_id,
    } } };
  }
  if (!username) return { status: 400, body: { error: "Enter a valid username." } };
  const material = await staffSetupMaterial(grantPepper, username);
  const internalEmail = `auth-${crypto.randomUUID()}@accounts.kavach.invalid`;
  const { data: auth, error: authError } = await service.auth.admin.createUser({
    email: internalEmail,
    email_confirm: true,
    app_metadata: { kavach_internal_identity: true },
  });
  if (authError || !auth.user) {
    return { status: 503, body: { error: "The resident account could not be prepared." } };
  }
  const { data: created, error: createError } = await service.rpc(
    qrRequestId ? "server_approve_resident_qr" : "server_create_resident_setup",
    {
      ...(qrRequestId ? { p_request_id: qrRequestId } : {}),
      p_provision_operation_id: crypto.randomUUID(),
      p_password_operation_id: material.passwordOperationId,
      p_grant_id: material.grantId,
      p_auth_user_id: auth.user.id,
      p_auth_email: internalEmail,
      p_username: username,
      p_resident_id: residentId,
      p_code_digest: material.digest,
      p_expires_at: material.expiresAt,
      p_created_by: account.account_link_id,
    },
  );
  const row = (created as Array<{ account_link_id: string }> | null)?.[0];
  if (createError || !row) {
    // A lost response can hide a committed account. Never delete a linked
    // Auth identity, and retain it for reconciliation if the lookup fails.
    const { data: linked, error: lookupError } = await service.from("account_links")
      .select("id").eq("auth_user_id", auth.user.id).maybeSingle();
    if (!lookupError && !linked) await service.auth.admin.deleteUser(auth.user.id).catch(() => null);
    return { status: 409, body: { error: "Check eligibility and choose an unused username, then try again." } };
  }
  return { status: 200, body: { setup: {
    accountId: row.account_link_id,
    residentId,
    username,
    code: material.code,
    expiresAt: material.expiresAt,
    communityId: resident.community_id,
  } } };
}

async function ownerMutation(
  body: Record<string, unknown>,
  service: SupabaseClient,
  account: AuthenticatedAccount,
  roles: RoleRow[],
  grantPepper: string | null,
) {
  if (!hasOwnerRole(roles)) {
    return {
      status: 403,
      body: { error: "You do not have permission to do that." },
    };
  }

  if (body.action === "create_staff_setup") {
    const displayName = textInput(body.displayName, 2, 160);
    const username = normalizeUsername(body.username);
    const communityId = typeof body.communityId === "string"
      ? body.communityId
      : null;
    if (!displayName || !username || !communityId) {
      return {
        status: 400,
        body: { error: "Enter a valid name, username and community." },
      };
    }
    if (!grantPepper) {
      return {
        status: 503,
        body: { error: "Account setup is not configured." },
      };
    }

    const { data: community, error: communityError } = await service
      .from("communities")
      .select("id")
      .eq("id", communityId)
      .eq("active", true)
      .maybeSingle();
    if (communityError || !community) {
      return { status: 404, body: { error: "Active community not found." } };
    }

    const { data: existing, error: existingError } = await service.rpc(
      "server_resolve_login",
      { p_identifier: username },
    );
    if (existingError) throw existingError;
    if ((existing as LoginResolution[] | null)?.[0]) {
      return {
        status: 409,
        body: { error: "That username is already in use." },
      };
    }

    const material = await staffSetupMaterial(grantPepper, username);
    const provisionOperationId = crypto.randomUUID();
    const internalEmail = `auth-${crypto.randomUUID()}@accounts.kavach.invalid`;
    const { data: createdAuth, error: createAuthError } = await service.auth
      .admin
      .createUser({
        email: internalEmail,
        email_confirm: true,
        app_metadata: { kavach_internal_identity: true },
      });
    if (createAuthError || !createdAuth.user) {
      return {
        status: 503,
        body: { error: "The administrator account could not be prepared." },
      };
    }

    const { data: created, error: createError } = await service.rpc(
      "server_create_staff_setup",
      {
        p_provision_operation_id: provisionOperationId,
        p_password_operation_id: material.passwordOperationId,
        p_grant_id: material.grantId,
        p_auth_user_id: createdAuth.user.id,
        p_auth_email: internalEmail,
        p_username: username,
        p_display_name: displayName,
        p_community_id: communityId,
        p_code_digest: material.digest,
        p_expires_at: material.expiresAt,
        p_created_by: account.account_link_id,
      },
    );
    const createdRow = (created as Array<{ account_link_id: string }> | null)
      ?.[0];
    if (createError || !createdRow) {
      await service.auth.admin.deleteUser(createdAuth.user.id).catch(() =>
        null
      );
      return {
        status: createError?.message.includes("username already in use")
          ? 409
          : 503,
        body: {
          error: createError?.message.includes("username already in use")
            ? "That username is already in use."
            : "The administrator account could not be prepared.",
        },
      };
    }
    const setup: StaffSetupGrant = {
      accountId: createdRow.account_link_id,
      username,
      code: material.code,
      expiresAt: material.expiresAt,
      communityId,
    };
    return { status: 200, body: { setup } };
  }

  if (body.action === "regenerate_staff_setup") {
    const accountId = typeof body.accountId === "string"
      ? body.accountId
      : null;
    if (!accountId) {
      return { status: 400, body: { error: "Select an administrator." } };
    }
    if (!grantPepper) {
      return {
        status: 503,
        body: { error: "Account setup is not configured." },
      };
    }
    const usernames = await usernamesFor(service, [accountId]);
    const username = usernames.get(accountId);
    if (!username) {
      return { status: 404, body: { error: "Administrator not found." } };
    }
    const material = await staffSetupMaterial(grantPepper, username);
    const { data, error } = await service.rpc("server_regenerate_staff_setup", {
      p_account_link_id: accountId,
      p_password_operation_id: material.passwordOperationId,
      p_grant_id: material.grantId,
      p_code_digest: material.digest,
      p_expires_at: material.expiresAt,
      p_created_by: account.account_link_id,
    });
    const row = (data as Array<{ grant_id: string }> | null)?.[0];
    if (error || !row) {
      return {
        status: 400,
        body: { error: "A new setup code could not be generated." },
      };
    }
    const { data: assignment } = await service
      .from("role_assignments")
      .select("community_id")
      .eq("account_link_id", accountId)
      .eq("role", "community_staff")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    const setup: StaffSetupGrant = {
      accountId,
      username,
      code: material.code,
      expiresAt: material.expiresAt,
      communityId: String(assignment?.community_id ?? ""),
    };
    return { status: 200, body: { setup } };
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

  if (body.action === "delete_community") {
    if (typeof body.communityId !== "string" || typeof body.confirmationName !== "string") return { status: 400, body: { error: "Confirm the community name." } };
    const { error } = await service.rpc("server_delete_community", { p_community_id: body.communityId, p_actor: account.account_link_id, p_confirmation_name: body.confirmationName });
    if (error) return { status: error.code === "42501" ? 403 : 409, body: { error: "Community could not be deleted. Check the confirmation name and refresh before trying again." } };
    return { status: 200, body: { deleted: true } };
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
      .is("deleted_at", null)
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

async function sosMutation(
  body: Record<string, unknown>,
  service: SupabaseClient,
  account: AuthenticatedAccount,
  roles: RoleRow[],
) {
  const incidentId = textInput(body.incidentId, 36, 36);
  const hasResidentRole = roles.some((role) => role.role === "resident");
  const hasStaffRole = roles.some((role) => role.role === "community_staff");

  if (body.action === "sos_snapshot") {
    if (!hasResidentRole && !hasStaffRole) {
      return { status: 403, body: { error: "This account cannot view SOS alerts." } };
    }
    const { data, error } = await service.rpc("server_sos_snapshot", {
      p_actor_account_link_id: account.account_link_id,
    });
    if (error) throw error;
    return { status: 200, body: { incidents: data ?? [] } };
  }

  if (body.action === "sos_history") {
    if (!hasStaffRole || account.account_kind !== "staff") {
      return { status: 403, body: { error: "This account cannot view SOS history." } };
    }
    const requestedLimit = typeof body.limit === "number" && Number.isInteger(body.limit)
      ? body.limit
      : 100;
    const { data, error } = await service.rpc("server_sos_history", {
      p_actor_account_link_id: account.account_link_id,
      p_limit: Math.min(Math.max(requestedLimit, 1), 200),
    });
    if (error) throw error;
    return { status: 200, body: { incidents: data ?? [] } };
  }

  if (body.action === "sos_create_incident") {
    const locationLabel = textInput(body.locationLabel, 2, 200);
    const radius = typeof body.alertRadiusMetres === "number"
      ? body.alertRadiusMetres
      : 50;
    const locationSource = body.locationSource === "device_gps"
      ? "device_gps"
      : "registered_house";
    if (account.account_kind !== "resident" || !hasResidentRole || !locationLabel || !Number.isInteger(radius)) {
      return { status: 403, body: { error: "This account cannot send an SOS." } };
    }
    const latitude = body.latitude;
    const longitude = body.longitude;
    if (locationSource === "device_gps" &&
      (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
       typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180)) {
      return { status: 400, body: { error: "Valid GPS coordinates are required." } };
    }
    const { data, error } = await service.rpc("server_create_sos_incident", {
      p_actor_account_link_id: account.account_link_id,
      p_alert_radius_metres: radius,
      p_latitude: locationSource === "device_gps" ? latitude : null,
      p_location_label: locationLabel,
      p_location_source: locationSource,
      p_longitude: locationSource === "device_gps" ? longitude : null,
    });
    const row = (data as Array<{ incident_id: string }> | null)?.[0];
    if (error || !row) throw error ?? new Error("sos_create_failed");
    return {
      status: 201,
      body: { incidentId: row.incident_id, result: "created", status: "sent" },
    };
  }

  if (body.action === "sos_accept_incident") {
    return {
      status: 409,
      body: { error: "Update Kavach before responding. Location verification is now required." },
    };
  }

  if (body.action === "sos_accept_incident_v2") {
    if (!incidentId || account.account_kind !== "resident" || !hasResidentRole) {
      return { status: 403, body: { error: "This account cannot respond to this SOS." } };
    }
    const latitude = body.latitude;
    const longitude = body.longitude;
    const accuracyMetres = body.accuracyMetres;
    const recordedAt = typeof body.recordedAt === "string" ? body.recordedAt : "";
    const recordedAtMs = Date.parse(recordedAt);
    if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      typeof accuracyMetres !== "number" || !Number.isFinite(accuracyMetres) || accuracyMetres < 0 ||
      !Number.isFinite(recordedAtMs)) {
      return { status: 400, body: { error: "A fresh GPS location is required before you can respond." } };
    }
    const { data, error } = await service.rpc("server_accept_sos_incident", {
      p_actor_account_link_id: account.account_link_id,
      p_incident_id: incidentId,
      p_responder_accuracy_metres: accuracyMetres,
      p_responder_latitude: latitude,
      p_responder_location_recorded_at: new Date(recordedAtMs).toISOString(),
      p_responder_longitude: longitude,
    });
    const row = (data as Array<{ result: string; incident_status: string | null; distance_metres: number | string | null }> | null)?.[0];
    if (error || !row) throw error ?? new Error("sos_accept_failed");
    const distanceMetres = row.distance_metres == null ? undefined : Number(row.distance_metres);
    return {
      status: row.result === "accepted" ? 200 : 409,
      body: {
        result: row.result,
        status: row.incident_status ?? "sent",
        ...(Number.isFinite(distanceMetres) ? { distanceMetres } : {}),
        ...(row.result === "already_assigned"
          ? { error: "Another community member has already accepted this SOS." }
          : row.result === "not_eligible"
          ? { error: "You are no longer eligible to respond to this SOS." }
          : row.result === "outside_radius"
          ? { error: `You are ${Math.round(distanceMetres ?? 0)} metres away. Move within 50 metres of the alert before responding.` }
          : row.result === "location_inaccurate"
          ? { error: "GPS accuracy is too low. Move outdoors or near a window, then try again." }
          : row.result === "location_stale"
          ? { error: "Your GPS location is out of date. Try again to capture a fresh location." }
          : row.result === "alert_location_unavailable"
          ? { error: "This alert does not have a phone GPS location, so distance cannot be verified." }
          : row.result === "location_unavailable"
          ? { error: "A valid GPS location is required before you can respond." }
          : {}),
      },
    };
  }

  if (body.action === "sos_decline_incident") {
    if (!incidentId || account.account_kind !== "resident" || !hasResidentRole) {
      return { status: 403, body: { error: "This account cannot decline this SOS." } };
    }
    const { data, error } = await service.rpc("server_decline_sos_incident", {
      p_actor_account_link_id: account.account_link_id,
      p_incident_id: incidentId,
    });
    const row = (data as Array<{ result: string; incident_status: string | null }> | null)?.[0];
    if (error || !row) throw error ?? new Error("sos_decline_failed");
    return {
      status: row.result === "updated" ? 200 : 409,
      body: {
        result: row.result,
        status: row.incident_status ?? "sent",
        ...(row.result === "not_eligible"
          ? { error: "This SOS is no longer available to decline." }
          : row.result === "invalid_state"
          ? { error: "This SOS can no longer be declined." }
          : row.result === "not_found"
          ? { error: "This SOS is no longer active." }
          : {}),
      },
    };
  }

  if (body.action === "sos_withdraw_response") {
    if (!incidentId || account.account_kind !== "resident" || !hasResidentRole) {
      return { status: 403, body: { error: "This account cannot withdraw this response." } };
    }
    const { data, error } = await service.rpc("server_withdraw_sos_response", {
      p_actor_account_link_id: account.account_link_id,
      p_incident_id: incidentId,
    });
    const row = (data as Array<{ result: string; incident_status: string | null }> | null)?.[0];
    if (error || !row) throw error ?? new Error("sos_withdraw_failed");
    return {
      status: row.result === "updated" ? 200 : 409,
      body: {
        result: row.result,
        status: row.incident_status ?? "sent",
        ...(row.result === "not_eligible"
          ? { error: "Only the assigned responder can cancel this response." }
          : row.result === "invalid_state"
          ? { error: "This response can no longer be cancelled." }
          : row.result === "not_found"
          ? { error: "This SOS is no longer active." }
          : {}),
      },
    };
  }

  if (body.action === "sos_cancel_incident") {
    if (!incidentId || account.account_kind !== "resident" || !hasResidentRole) {
      return { status: 403, body: { error: "This account cannot cancel this SOS." } };
    }
    const { data, error } = await service.rpc("server_cancel_sos_incident", {
      p_actor_account_link_id: account.account_link_id,
      p_incident_id: incidentId,
    });
    const row = (data as Array<{ result: string; incident_status: string | null }> | null)?.[0];
    if (error || !row) throw error ?? new Error("sos_cancel_failed");
    return {
      status: row.result === "updated" ? 200 : 409,
      body: {
        result: row.result,
        status: row.incident_status ?? "sent",
        ...(row.result === "not_eligible"
          ? { error: "Only the resident who sent this alert can cancel it." }
          : row.result === "invalid_state"
          ? { error: "This alert can no longer be cancelled." }
          : {}),
      },
    };
  }

  if (body.action === "sos_update_incident") {
    const incidentAction = body.incidentAction;
    if (!incidentId || (incidentAction !== "acknowledge" && incidentAction !== "arrive" && incidentAction !== "resolve")) {
      return { status: 400, body: { error: "Invalid SOS update." } };
    }
    if ((incidentAction === "acknowledge" && !hasStaffRole) || (incidentAction === "arrive" && !hasResidentRole) || (incidentAction === "resolve" && !hasStaffRole && !hasResidentRole)) {
      return { status: 403, body: { error: "This account cannot make that SOS update." } };
    }
    const { data, error } = await service.rpc("server_update_sos_incident", {
      p_action: incidentAction,
      p_actor_account_link_id: account.account_link_id,
      p_incident_id: incidentId,
    });
    const row = (data as Array<{ result: string; incident_status: string | null }> | null)?.[0];
    if (error || !row) throw error ?? new Error("sos_update_failed");
    return {
      status: row.result === "updated" ? 200 : 409,
      body: { result: row.result, status: row.incident_status ?? "sent" },
    };
  }

  return null;
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
  const grantPepper = Deno.env.get("KAVACH_GRANT_PEPPER") ?? null;
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

  if (body.action === "request_resident_qr_enrollment") {
    const token = typeof body.token === "string" ? body.token.trim().toLowerCase() : "";
    const username = normalizeUsername(body.username);
    if (!/^[0-9a-f]{64}$/.test(token) || !username) {
      return response({ error: "Scan a valid Kavach QR and choose a valid username." }, 400, corsOrigin);
    }
    try {
      const limited = await consumeRateLimit(
        rpc,
        await hmacBucket(pepper, "network", clientAddress(request.headers)),
        "qr_enrollment_network", 20,
      );
      if (!limited.allowed) return response({ error: "Too many requests. Please try again later." }, 429, corsOrigin);
      const digest = await enrollmentTokenDigest(token);
      const { error: claimError } = await service.rpc("server_request_resident_qr", {
        p_digest: digest, p_username: username,
      });
      if (claimError) return response({ error: "This QR has expired, was already used, or is unavailable. Ask the community office to review your enrollment." }, 409, corsOrigin);
      return response({ requested: true }, 200, corsOrigin);
    } catch {
      return response({ error: "Enrollment requests are temporarily unavailable." }, 503, corsOrigin);
    }
  }

  if (body.action === "complete_account_setup") {
    const username = normalizeUsername(body.username);
    const code = normalizeSetupCode(body.code);
    const passwordError = passwordPolicyError(body.password);
    if (!username || !code || passwordError || !grantPepper) {
      return response(
        {
          error: passwordError ??
            (grantPepper
              ? "Enter your username and six-digit setup code."
              : "Account setup is not configured."),
        },
        grantPepper ? 400 : 503,
        corsOrigin,
      );
    }
    try {
      const [identifierLimit, networkLimit] = await Promise.all([
        consumeRateLimit(
          rpc,
          await hmacBucket(pepper, "identifier", `setup:${username}`),
          "setup_identifier",
          5,
        ),
        consumeRateLimit(
          rpc,
          await hmacBucket(pepper, "network", clientAddress(request.headers)),
          "setup_network",
          20,
        ),
      ]);
      if (!identifierLimit.allowed || !networkLimit.allowed) {
        const retryAfter = Math.max(
          identifierLimit.retry_after_seconds,
          networkLimit.retry_after_seconds,
        );
        const limited = response(
          {
            error:
              "Too many attempts. Please wait or ask the office for a new code.",
          },
          429,
          corsOrigin,
        );
        limited.headers.set("retry-after", String(retryAfter));
        return limited;
      }

      const digest = await hmacDigest(
        grantPepper,
        `setup:${username}`,
        code,
      );
      let { data: begun, error: beginError } = await service.rpc(
        "server_begin_setup_redemption",
        { p_username: username, p_code_digest: digest },
      );
      if (!beginError &&
        (begun as Array<{ redemption_status: string }> | null)?.[0]
            ?.redemption_status === "invalid") {
        const residentAttempt = await service.rpc(
          "server_begin_resident_setup_redemption",
          { p_username: username, p_code_digest: digest },
        );
        begun = residentAttempt.data;
        beginError = residentAttempt.error;
      }
      const grant = (begun as
        | Array<{
          redemption_status: string;
          auth_user_id: string | null;
          operation_id: string | null;
        }>
        | null)?.[0];
      if (beginError || !grant) {
        throw beginError ?? new Error("grant_unavailable");
      }
      const statusMessages: Record<string, { status: number; error: string }> =
        {
          invalid: {
            status: 400,
            error: "The username or setup code is incorrect.",
          },
          expired: {
            status: 410,
            error:
              "This setup code has expired. Ask the office for a new code.",
          },
          blocked: {
            status: 429,
            error: "This setup code is blocked. Ask the office for a new code.",
          },
          used: {
            status: 409,
            error: "This setup code has already been used. Return to sign in.",
          },
          in_progress: {
            status: 409,
            error: "This setup needs help from the community office.",
          },
        };
      if (grant.redemption_status !== "claimed") {
        const failure = statusMessages[grant.redemption_status] ??
          statusMessages.invalid;
        return response({ error: failure.error }, failure.status, corsOrigin);
      }
      if (!grant.auth_user_id || !grant.operation_id) {
        throw new Error("grant_target_missing");
      }

      let passwordUpdated = false;
      try {
        const { error: passwordUpdateError } = await service.auth.admin
          .updateUserById(grant.auth_user_id, {
            password: body.password as string,
          });
        if (passwordUpdateError) {
          await service.rpc("server_finish_setup_redemption", {
            p_operation_id: grant.operation_id,
            p_outcome: "failed",
            p_error_code: "auth_password_rejected",
          });
          return response(
            {
              error:
                "Your password could not be saved. Ask the office for a new setup code.",
            },
            400,
            corsOrigin,
          );
        }
        passwordUpdated = true;
        const { data: finished, error: finishError } = await service.rpc(
          "server_finish_setup_redemption",
          {
            p_operation_id: grant.operation_id,
            p_outcome: "completed",
            p_error_code: null,
          },
        );
        if (finishError || finished !== true) {
          await service.rpc("server_finish_setup_redemption", {
            p_operation_id: grant.operation_id,
            p_outcome: "needs_reconciliation",
            p_error_code: "setup_finalize_uncertain",
          });
          throw new Error("setup_finalize_uncertain");
        }
      } catch {
        if (!passwordUpdated) {
          await service.rpc("server_finish_setup_redemption", {
            p_operation_id: grant.operation_id,
            p_outcome: "needs_reconciliation",
            p_error_code: "auth_update_uncertain",
          });
        }
        return response(
          {
            error:
              "Account setup could not be completed. Please ask the office for help.",
          },
          503,
          corsOrigin,
        );
      }
      return response(
        { completed: true, username },
        200,
        corsOrigin,
      );
    } catch {
      return response(
        {
          error: "Account setup is temporarily unavailable. Please try again.",
        },
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
    const sosResult = await sosMutation(body, service, account, roles);
    if (sosResult) return response(sosResult.body, sosResult.status, corsOrigin);
    const enrollmentResult = await enrollResident(body, service, account, roles);
    if (enrollmentResult) return response(enrollmentResult.body, enrollmentResult.status, corsOrigin);

    const residentQrResult = await residentQrMutation(body, service, account, roles, grantPepper);
    if (residentQrResult) return response(residentQrResult.body, residentQrResult.status, corsOrigin);
    const residentSetupResult = await residentSetupMutation(
      body, service, account, roles, grantPepper,
    );
    if (residentSetupResult) {
      return response(residentSetupResult.body, residentSetupResult.status, corsOrigin);
    }
    const result = await ownerMutation(
      body,
      service,
      account,
      roles,
      grantPepper,
    );
    return response(result.body, result.status, corsOrigin);
  } catch (reason) {
    const errorCode = typeof reason === "object" && reason !== null &&
        "code" in reason
      ? String(reason.code).slice(0, 40)
      : reason instanceof Error
      ? reason.name
      : "unknown";
    console.error(JSON.stringify({ event: "account_api_failure", errorCode }));
    return response(
      { error: "Kavach could not complete this request. Please try again." },
      503,
      corsOrigin,
    );
  }
}

export default { fetch: handleRequest };
export { handleRequest };

