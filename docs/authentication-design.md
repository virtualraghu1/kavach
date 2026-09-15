# Authentication design decision

Status: accepted for the Phase 2 sign-in slice on 14 September 2026.

## Decision

Supabase Auth remains the only password verifier and session issuer. Kavach does
not store password hashes or mint authentication tokens. Clients send a username
or verified personal email and the unmodified password to the `account-api`
Edge Function over HTTPS. The function privately resolves the identifier, then
uses a separate request-scoped public Supabase client to authenticate the
resolved Auth identity.

The service-role client is separate from the credential client. It may call only
the reviewed server RPCs needed to resolve login identifiers, consume durable
rate limits and acknowledge a successful sign-in. The browser and mobile app
never receive the service-role key or the internal Auth email mapping.

## No-email residents

A resident may have a Kavach account without a personal email address. During
the later account-provisioning slice, the server will create an opaque internal
Auth alias such as `auth-<random UUID>@accounts.kavach.invalid`. The `.invalid`
top-level domain is reserved and cannot receive internet mail. The alias:

- is random and is not derived from a name, house number or phone number;
- is stored only in the private login-identifier record and Supabase Auth;
- is never presented as the resident's contact email or verified ownership;
- is never used for outbound confirmation or recovery delivery; and
- is resolved only inside the server sign-in service.

The resident signs in with a globally unique, case-insensitive username. A real
personal email can become an additional identifier only after the account-linking
workflow has verified that address. Existing safe linked email accounts must be
preserved.

## Sign-in request

`POST /functions/v1/account-api` accepts the public sign-in action:

```json
{
  "action": "sign_in",
  "identifier": "lakshmi.r",
  "password": "the resident's unmodified password"
}
```

The service normalises only the identifier by trimming and lower-casing it.
Passwords are never trimmed, transformed or logged. Unknown identifiers,
disabled accounts and wrong passwords receive the same error. Authentication
and recovery responses use `Cache-Control: no-store`.

Browser origins must exactly match the comma-separated allowlist. Native
requests without an `Origin` header are accepted; access to data still requires
the normal Supabase session and database policies.

## Durable throttling

Every attempt consumes two database-backed limits: one for the normalised
identifier and one for the client network address. Each stored bucket is an
HMAC-SHA-256 digest with a server-only pepper, so raw usernames, emails and IP
addresses are not written to the rate-limit table. The current source permits
ten attempts per identifier and fifty attempts per network bucket in fifteen
minutes, then blocks further attempts for fifteen minutes. The database
operation is atomic and survives serverless instance changes. A later
refinement should record failures separately so successful routine sign-ins do
not consume the same failure budget.

## Authenticated workspace and user management

All other actions require a bearer access token. The Edge Function verifies the
token with Supabase Auth, extracts its `session_id`, and asks a service-only
database function to confirm that the exact Auth session belongs to an active
Kavach account and predates no revocation boundary.

The `workspace` action derives roles and community scope from current database
records. It returns only the communities, residents and account states allowed
for that role. Owner mutations are restricted to:

- creating a community;
- enabling or disabling a community; and
- enabling or disabling an existing society-administrator account.

The function rechecks the owner role before every mutation and writes a security
event. A client-provided role or community identifier never establishes
permission. Disabling a staff account also records `revoked_before`, while RLS
and authenticated APIs reject disabled accounts immediately.

## Activation acknowledgement

A password match alone does not activate a resident. After Supabase Auth returns
a genuine session, the service verifies the current account state. A resident
must still have an active membership, valid office verification, active
enrollment consent and an active resident role for the same community. Only then
may a pending account become active, and the event is written to the audit log.
Repeated successful sign-ins do not activate the account twice.

This acknowledgement means only that account sign-in succeeded. It does not
claim installation, push-notification delivery, GPS access or emergency
readiness.

## Owner and staff provisioning

There is no public signup-to-role route. In particular, the first public signup
must never become owner. Owner bootstrap is a controlled offline operation:

1. an authorised operator creates the initial Supabase Auth user through the
   protected administrative path;
2. a reviewed, one-time database operation links that exact Auth user to an
   owner account and role;
3. a second authorised person verifies the target project, user ID and audit
   event; and
4. the bootstrap route is disabled or removed after use.

The owner later provisions community staff through a protected server workflow.
Ordinary staff cannot grant roles, recover staff/owner accounts or expand their
community assignment. Owner break-glass recovery must remain a separate,
audited operational procedure and must not be exposed as a public endpoint.

No owner or staff account has been bootstrapped yet.

## Required deployment configuration

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` to a deployed Edge Function. Kavach additionally
requires:

- `SUPABASE_PUBLISHABLE_KEY`: the project's public publishable key, when used
  instead of the legacy anon key;
- `KAVACH_ALLOWED_ORIGINS`: exact web origins, including the production Vercel
  origin and authorised local development origins; and
- `KAVACH_RATE_LIMIT_PEPPER`: a long random server-only secret, generated and
  stored separately from the database.

Only the public URL and publishable key belong in browser/native configuration.
The service-role key and pepper must never use a `VITE_`, `EXPO_PUBLIC_`,
`NEXT_PUBLIC_` or other client-exposed prefix.

## Current boundary and next checks

The account schema, web account-management migration and version 3 of
`account-api` are installed in the confirmed Kavach production project. Its
exact-origin allowlist and rate-limit pepper are configured as server secrets.
A live request with fictional invalid credentials returned the generic sign-in
error, correct production-origin CORS and `no-store` headers; a disallowed origin
was rejected. Public Auth signup is closed and the hosted password minimum is 12
characters.

There are still no Auth users or live resident accounts. Before provisioning:

1. review outbound email settings in Supabase Auth before enabling personal-email
   account flows;
2. execute the existing controlled owner-bootstrap operation with an explicitly
   chosen owner identity;
3. test the no-email flow with fictional users in a development/staging branch;
4. test throttling, disabled membership and cross-community denial with complete
   fixtures; and
5. review access-token lifetime and server-side revocation checks for recovery.

The `web_auth_user_management` migration, expanded Edge Function and web login
are deployed. Setup grants, assisted recovery, staff account creation and native
session storage remain subsequent working slices.
