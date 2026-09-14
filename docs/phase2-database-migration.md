# Phase 2 database migration

## Applied environment

- Supabase organisation: `kavach` (`nakqywjdrvcznouagawb`)
- Supabase project: `kavach` (`xvzymtkfzkoskljcexai`)
- Region: Mumbai (`ap-south-1`)
- Branch: `main` (production)
- Applied: 14 September 2026 through the authenticated Supabase SQL editor

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

- PostgreSQL 17 parser accepted all 74 migration statements.
- The SQL editor completed the migration transaction successfully.
- The canonical community query returned exactly one matching row.
- Nine public application tables reported RLS enabled.
- An anonymous REST request to `communities` returned HTTP 401 / PostgreSQL
  `42501` permission denied.
- Supabase Security Advisor reported 0 errors and 0 warnings after migration.
- PostgreSQL 17 parser accepted all 11 statements in the account sign-in RPC
  migration, and the SQL editor applied its transaction successfully.
- Database privilege checks returned `false` for `anon` and `authenticated`, and
  `true` for `service_role`, for each of the three sign-in RPCs.
- A direct anonymous REST call to `server_resolve_login` returned HTTP 401 /
  PostgreSQL `42501` permission denied.
- Supabase Security Advisor still reported 0 errors and 0 warnings after the
  follow-up migration.

Local Docker was unavailable, so `supabase db reset` and pgTAP were not run.
The migration was applied in the SQL editor rather than through `supabase db
push`; reconcile its applied state before adopting CLI-managed migration
history.

## Recovery and rollback

This migration is intentionally forward-only. Do not drop these tables after
real accounts or residents exist. Before pilot data, confirm backups and test a
restore in a non-production branch. If the empty schema must be removed before
any real records are created, prepare and review a separate rollback migration;
do not execute ad-hoc `drop ... cascade` commands.

## Sign-in function deployment

Version 1 of `account-api` was deployed on 14 September 2026 after the project
list positively matched project `xvzymtkfzkoskljcexai` to organisation
`nakqywjdrvcznouagawb`. Only the production/local origin allowlist and a random
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
