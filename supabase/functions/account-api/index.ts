import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  allowedOrigin,
  clientAddress,
  GENERIC_SIGN_IN_ERROR,
  hmacBucket,
  normalizeIdentifier,
} from "./core.ts";

type LoginResolution = {
  account_link_id: string;
  auth_user_id: string;
  auth_email: string;
  account_kind: "owner" | "staff" | "resident";
  account_status: "pending" | "active" | "disabled";
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
    headers.set("access-control-allow-headers", "authorization, content-type");
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
) {
  const { data, error } = await rpc("server_consume_rate_limit", {
    p_action: action,
    p_block_seconds: 900,
    p_bucket_key: bucket,
    p_limit: 5,
    p_window_seconds: 900,
  });
  const rows = data as
    | Array<{ allowed: boolean; retry_after_seconds: number }>
    | null;
  if (error || !rows?.[0]) throw new Error("rate_limit_unavailable");
  return rows[0];
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
  if (body.action !== "sign_in") {
    return response({ error: "Unsupported action." }, 400, corsOrigin);
  }

  const identifier = normalizeIdentifier(body.identifier);
  const password = body.password;
  if (!identifier || typeof password !== "string") {
    return response({ error: GENERIC_SIGN_IN_ERROR }, 401, corsOrigin);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const credentialClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rpc = service.rpc.bind(service) as unknown as RpcCall;

  try {
    const [identifierLimit, networkLimit] = await Promise.all([
      consumeRateLimit(
        rpc,
        await hmacBucket(pepper, "identifier", identifier),
        "sign_in_identifier",
      ),
      consumeRateLimit(
        rpc,
        await hmacBucket(pepper, "network", clientAddress(request.headers)),
        "sign_in_network",
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

    const { data, error } = await credentialClient.auth.signInWithPassword({
      email: login.auth_email,
      password,
    });
    if (error || !data.session || data.user.id !== login.auth_user_id) {
      return response({ error: GENERIC_SIGN_IN_ERROR }, 401, corsOrigin);
    }

    const { data: acknowledgement, error: acknowledgementError } = await rpc(
      "server_acknowledge_sign_in",
      { p_auth_user_id: data.user.id },
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

export default { fetch: handleRequest };
