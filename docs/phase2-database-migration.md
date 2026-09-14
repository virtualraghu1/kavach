# Phase 2 database migration

## Applied environment

- Supabase organisation: `Wellness of women private limited` (`faxhpalwqhkhfsysmalv`)
- Supabase project: `kavach` (`ldexvxjccihecrclirof`)
- Region: Mumbai (`ap-south-1`)
- Branch: `main` (production)
- Applied: 14 September 2026 through the authenticated Supabase integration

The project was confirmed to have no public tables or views before the
migration. Therefore, no existing community row or relationship was replaced.
The migration inserted one canonical pilot record with stable ID
`00000000-0000-4000-8000-000000000001` and display name
`HIG, BHEL Township, Hyderabad`.

## What was installed

Public, RLS-protected records cover communities, residents, memberships,
account links, role assignments, consent, verification, installation
acknowledgements and security events. Private records cover case-insensitive
login identifiers, setup/recovery grants, idempotent account operations and
durable rate-limit buckets.

Anonymous access has no table grants. Authenticated clients have select-only
access filtered by current active account, role, community and resident link.
Application writes remain server-only; no public mutation policies were added.
Pending setup/recovery grants are revoked when a membership is deactivated or
verification is invalidated.

The follow-up migration
`20260914061939_account_sign_in_api.sql` adds three server-only functions for
private identifier resolution, atomic durable sign-in throttling and an
eligibility-checked successful-sign-in acknowledgement. All three functions use
a fixed empty search path, revoke execution from public browser roles and grant
execution only to `service_role`.

## Verification evidence

- The authenticated Supabase migration API applied all three committed
  migrations and recorded them in the project's migration history.
- The canonical community query returned exactly one matching row.
- Nine public application tables reported RLS enabled.
- The project contained zero Auth users after migration.
- An anonymous REST request to `communities` returned HTTP 401 / PostgreSQL
  `42501` permission denied.
- Database privilege checks returned `false` for `anon` and `authenticated`, and
  `true` for `service_role`, for each of the three sign-in RPCs.
- A direct anonymous REST call to `server_resolve_login` returned HTTP 401 /
  PostgreSQL `42501` permission denied.
- Security Advisor returned four informational `rls_enabled_no_policy` findings
  for private tables. Those tables intentionally have RLS enabled without
  policies or browser-role grants so only the server-side service role can use
  them. It returned no error or warning findings.
- Performance Advisor returned informational findings for unindexed foreign
  keys, unused indexes in the fresh empty project and the Auth connection
  allocation. These remain performance follow-ups rather than connection
  blockers.

Local Docker was unavailable, so `supabase db reset` and pgTAP were not run.
The migration history is recorded in the target project and can be reconciled
with the committed files before a future CLI-managed schema change.

## Recovery and rollback

This migration is intentionally forward-only. Do not drop these tables after
real accounts or residents exist. Before pilot data, confirm backups and test a
restore in a non-production branch. If the empty schema must be removed before
any real records are created, prepare and review a separate rollback migration;
do not execute ad-hoc `drop ... cascade` commands.

## Sign-in function deployment

Version 2 of `account-api` was active on 14 September 2026 after the project
record positively matched project `ldexvxjccihecrclirof` to organisation
`faxhpalwqhkhfsysmalv`. Only the production origin allowlist and a random
server-side rate-limit pepper were added. The platform-provided Supabase URL,
publishable-key set and service credentials remain server-managed.

Post-deployment checks confirmed the function is `ACTIVE`, uses its committed
import map and has gateway JWT verification disabled because the same endpoint
must accept a public sign-in request. The handler performs action-specific
authentication. A fictional invalid login returned HTTP 401 with the generic
error, the exact production CORS origin, and `no-store`/`no-cache` headers. An
unapproved origin returned HTTP 403.

## Next gate

No owner, staff or resident Auth users were created. Before account
provisioning:

1. close public signup and verify current Auth/email settings;
2. implement and review the controlled owner-bootstrap operation;
3. bootstrap the owner only after explicit account-target approval; and
4. test two-community isolation in a staging branch with fictional fixtures.
