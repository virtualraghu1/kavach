# Staff setup-grant slice

Status: implemented and tested locally on 15 September 2026. Not deployed to
the hosted Kavach Supabase project or Vercel production.

## User workflow

1. The signed-in Kavach owner opens **Administrators**.
2. The owner enters the administrator's name, unique username and community.
3. Kavach creates an opaque internal Supabase Auth identity and a pending staff
   account assigned only to that active community.
4. Kavach displays one six-digit setup code with a ten-minute expiry.
5. The administrator opens **Set up my account**, enters the username and code,
   and chooses a private password.
6. The consumed code cannot be reused. The account remains pending until the
   administrator signs in successfully, then becomes active exactly once.

The owner never chooses, sees or retrieves the permanent password. The internal
Auth alias is not a personal email and is never presented as verified contact
information.

## Security controls

- Global, case-insensitive username uniqueness remains database enforced.
- Internal Auth aliases are random and use the reserved `.invalid` domain.
- Setup code digests use a separate server-only HMAC pepper and are bound to the
  setup purpose and username.
- The database stores no plain setup code or password.
- A grant expires within ten minutes, permits at most five incorrect attempts
  and can be consumed once.
- Regeneration revokes the earlier pending or claimed grant.
- An advisory transaction lock makes concurrent redemption resolve once.
- A pending account cannot activate without a consumed setup grant and a real
  authenticated sign-in.
- Owner and target-community eligibility are rechecked inside service-only
  database functions. The functions are not executable by `anon` or
  `authenticated`.
- The server uses a separate service client for Auth administration and never
  returns the opaque Auth email.
- Setup and authentication responses remain `no-store`; passwords, codes and
  tokens are not written to operational logs.

## Source

- `supabase/migrations/20260915020552_staff_setup_grants.sql`
- `supabase/functions/account-api/index.ts`
- `supabase/functions/account-api/core.ts`
- `admin/src/accountApi.ts`
- `admin/src/KavachApp.tsx`
- `scripts/staff-setup-local.integration.ts`

The Edge Function requires a new server-only `KAVACH_GRANT_PEPPER`. It must be a
separate long random value and must not use a browser/mobile-exposed prefix.

## Local verification

The migration was applied from a clean local database using Supabase CLI
2.117.0 with PostgreSQL 17 on the isolated `kavach` Colima profile. The local
security advisor reported no warning-or-higher findings.

The repeatable integration test is deliberately locked to localhost. Supply the
local values returned by `supabase status`; never put hosted credentials in the
command or a tracked file.

```sh
npx supabase db reset --local
npx deno@2.9.6 test supabase/functions/account-api/core.test.ts
npx deno@2.9.6 check scripts/staff-setup-local.integration.ts
```

The integration run verified:

- owner username/password sign-in;
- one community-bound staff setup issuance;
- sign-in denied before password setup;
- case-variant duplicate username rejection;
- regeneration revoking the previous code;
- one successful result under concurrent redemption;
- consumed-code rejection;
- five-attempt blocking;
- activation on the first successful staff sign-in; and
- denial of the second community from the staff workspace.

The real local browser flow additionally verified the owner form, rendered
setup code, private password form, setup-success state, normal staff sign-in,
Society Admin workspace and sign-out at 1440 x 900 and 390 x 844. There was no
horizontal overflow, framework overlay or relevant console warning/error.

## Production rollout checklist

Do not deploy only one layer. After separate production approval:

1. Reconfirm the Kavach organisation and project reference
   `ldexvxjccihecrclirof` and verify that no WOW Fitness project is selected.
2. Review and apply `20260915020552_staff_setup_grants.sql`.
3. Generate and store `KAVACH_GRANT_PEPPER` as an Edge Function secret.
4. Deploy the reviewed `account-api` function with its existing custom JWT
   validation setting unchanged.
5. Deploy the matching web build.
6. Repeat the fictional staff setup and cross-community tests in a controlled
   staging environment before any real staff account is created.
7. Re-run Supabase security advisors and verify the exact production origin,
   `no-store` headers, generic sign-in errors and session revocation boundary.

No production staff account, resident account or setup code was created in this
implementation run.

## Deferred

- Real resident enrollment writes and verification/consent transactions.
- Resident setup grants and resident-account activation UI.
- Office-assisted password recovery and owner break-glass recovery.
- Expo Android/iPhone resident application.
- SOS, GPS, push notifications and emergency delivery.
