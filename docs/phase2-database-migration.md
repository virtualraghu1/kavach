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

## Verification evidence

- PostgreSQL 17 parser accepted all 74 migration statements.
- The SQL editor completed the migration transaction successfully.
- The canonical community query returned exactly one matching row.
- Nine public application tables reported RLS enabled.
- An anonymous REST request to `communities` returned HTTP 401 / PostgreSQL
  `42501` permission denied.
- Supabase Security Advisor reported 0 errors and 0 warnings after migration.

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

## Next gate

No owner, staff or resident Auth users were created. Before account provisioning:

1. implement and review the server-only account/setup/recovery endpoints;
2. configure a server-side grant pepper and privileged Supabase key;
3. close public signup and verify current Auth settings;
4. bootstrap the owner through the documented offline route;
5. test two-community isolation in a staging branch with fictional fixtures.
