# Phase One: staging and owner bootstrap

Status on 14 September 2026: local implementation complete; remote execution
blocked by the staging and owner-identity gates below.

## Environment decision

The confirmed Kavach organisation is on the Supabase Free plan. The account
already uses its two free-project allowance across the Kavach and unrelated
WOW Fitness organisations. An empty, non-persistent Micro preview branch was
attempted without production data, but Supabase rejected it with HTTP 402 before
creation because Branching requires Pro. No branch was created and no charge
was incurred.

Upgrading only to obtain a long-running staging environment is not justified for
this charity pilot. The least-cost safe options are:

1. install a local Docker-compatible runtime and use `supabase start` at no
   Supabase hosting cost; or
2. temporarily upgrade Kavach, create an empty Micro branch for bounded tests,
   and delete it immediately after verification.

Production is not an acceptable substitute for setup/recovery experiments.

## Implemented bootstrap boundary

Migration `20260914073833_controlled_owner_bootstrap.sql` adds a single
service-role-only RPC. It:

- obtains a transaction advisory lock so two first-owner operations cannot win;
- accepts only an existing exact Supabase Auth user;
- creates the owner account link, username identifier and owner role together;
- records a verified email only when it matches the confirmed Auth identity and
  is not an internal `.invalid` alias;
- rejects a second owner, an already-linked Auth user and invalid usernames;
- records an idempotent operation and security audit event; and
- grants execution to `service_role` only.

The companion command in [`../scripts/bootstrap-owner.ts`](../scripts/bootstrap-owner.ts)
verifies that the Supabase URL matches the project reference and requires the
operator to repeat the exact project and Auth-user IDs in a confirmation value.
It refuses the known production project unless a separate production opt-in is
present. It never creates an Auth user, chooses a password or prints email,
password or credential material.

## Before execution

1. Establish the isolated environment using one of the options above.
2. Apply all committed migrations there and run the Security Advisor.
3. Create one fictional Auth user through an authorised administrative path;
   the tester chooses the password privately.
4. Run the bootstrap command with an ignored environment file based on
   `supabase/bootstrap.env.example`.
5. Verify the username sign-in through `account-api`, the owner role, the audit
   event, idempotent retry and rejection of a second owner.
6. Remove the fictional user and temporary hosted environment after testing.

Production bootstrap remains blocked until the project owner supplies and
approves the exact owner Auth user ID and username, plus an optional personal
email that has genuinely been verified.
