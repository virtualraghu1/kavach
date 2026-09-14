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

`POST /functions/v1/account-api` currently accepts only:

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
addresses are not written to the rate-limit table. The current conservative
default permits five attempts in fifteen minutes and blocks further attempts
for fifteen minutes. The database operation is atomic and survives serverless
instance changes.

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

The database RPC migration is installed in the confirmed Kavach production
project, but the `account-api` Edge Function is intentionally not deployed.
There are no Auth users or live resident accounts. Before deployment:

1. review and explicitly approve production function deployment and secrets;
2. verify public signup and outbound email settings in Supabase Auth;
3. test the no-email flow with fictional users in a development/staging branch;
4. test generic errors, throttling, disabled membership and cross-community
   denial; and
5. review access-token lifetime and server-side revocation checks for recovery.

Setup grants, assisted recovery, staff account management and native session
storage are intentionally handled in subsequent working slices.
