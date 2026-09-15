import { z } from "zod";
import { supabase, supabaseConfigured } from "./supabaseClient";

const roleSchema = z.object({
  role: z.enum(["owner", "community_staff", "resident"]),
  communityId: z.string().nullable(),
});

const communitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  officeContactText: z.string().nullable(),
  timezone: z.string(),
  active: z.boolean(),
});

const residentSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  fullName: z.string(),
  houseNumber: z.string(),
  block: z.string().nullable(),
  category: z.enum(["senior", "community_member"]),
  preferredLanguage: z.string().nullable(),
  profileStatus: z.enum(["draft", "active", "inactive"]),
  membershipStatus: z.enum(["draft", "active", "inactive"]),
  verified: z.boolean(),
  consentRecorded: z.boolean(),
  accountStatus: z.enum(["not_created", "pending", "active", "disabled"]),
  activatedAt: z.string().nullable(),
  createdAt: z.string(),
});

const staffSchema = z.object({
  accountId: z.string(),
  username: z.string(),
  displayName: z.string(),
  status: z.enum(["pending", "active", "disabled"]),
  activatedAt: z.string().nullable(),
  assignments: z.array(
    z.object({ communityId: z.string(), active: z.boolean() }),
  ),
});

export const workspaceSchema = z.object({
  account: z.object({
    id: z.string(),
    kind: z.enum(["owner", "staff", "resident"]),
    status: z.literal("active"),
    username: z.string(),
    displayName: z.string(),
  }),
  roles: z.array(roleSchema),
  communities: z.array(communitySchema),
  residents: z.array(residentSchema),
  staff: z.array(staffSchema),
});

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceCommunity = z.infer<typeof communitySchema>;
export type WorkspaceResident = z.infer<typeof residentSchema>;
export type WorkspaceStaff = z.infer<typeof staffSchema>;

const staffSetupGrantSchema = z.object({
  accountId: z.string().uuid(),
  username: z.string(),
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.string(),
  communityId: z.string().uuid(),
});

export type StaffSetupGrant = z.infer<typeof staffSetupGrantSchema>;

type SessionTokens = {
  access_token: string;
  refresh_token: string;
};

export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function endpoint() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!url || !supabaseConfigured) {
    throw new AccountApiError(
      "Kavach account services are not configured in this build.",
      503,
    );
  }
  return `${url}/functions/v1/account-api`;
}

async function request(
  body: Record<string, unknown>,
  accessToken?: string,
): Promise<Record<string, unknown>> {
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const result = await fetch(endpoint(), {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await result.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!result.ok) {
    throw new AccountApiError(
      typeof payload.error === "string"
        ? payload.error
        : "Kavach could not complete this request. Please try again.",
      result.status,
    );
  }
  return payload;
}

export async function signIn(identifier: string, password: string) {
  if (!supabase) {
    throw new AccountApiError(
      "Kavach account services are not configured in this build.",
      503,
    );
  }
  const payload = await request({ action: "sign_in", identifier, password });
  const session = payload.session as SessionTokens | undefined;
  if (!session?.access_token || !session.refresh_token) {
    throw new AccountApiError("Sign-in returned an invalid session.", 503);
  }
  const { data, error } = await supabase.auth.setSession(session);
  if (error || !data.session) {
    throw new AccountApiError(
      "Kavach could not save your sign-in securely. Please try again.",
      503,
    );
  }
  return data.session;
}

export async function loadWorkspace(accessToken: string) {
  const payload = await request({ action: "workspace" }, accessToken);
  return workspaceSchema.parse(payload.workspace);
}

export async function completeAccountSetup(
  username: string,
  code: string,
  password: string,
) {
  const payload = await request({
    action: "complete_account_setup",
    username,
    code,
    password,
  });
  return z.object({ completed: z.literal(true), username: z.string() }).parse(
    payload,
  );
}

export async function createStaffSetup(
  values: { displayName: string; username: string; communityId: string },
  accessToken: string,
) {
  const payload = await request(
    { action: "create_staff_setup", ...values },
    accessToken,
  );
  return staffSetupGrantSchema.parse(payload.setup);
}

export async function regenerateStaffSetup(
  accountId: string,
  accessToken: string,
) {
  const payload = await request(
    { action: "regenerate_staff_setup", accountId },
    accessToken,
  );
  return staffSetupGrantSchema.parse(payload.setup);
}

export async function accountMutation(
  action:
    | "create_community"
    | "set_community_status"
    | "set_staff_account_status",
  values: Record<string, unknown>,
  accessToken: string,
) {
  return request({ action, ...values }, accessToken);
}
