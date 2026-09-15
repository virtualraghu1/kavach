# Kavach

Project workspace for Kavach, a community SOS concept.

## Web accounts and admin interface

The web application in [`admin/`](admin/README.md) now contains a Supabase-backed
sign-in gate and role-specific workspaces for Kavach owner, society admin and
resident accounts. The earlier fictional enrollment interface remains available
only through an explicit development preview. See the admin README for run
commands, verified screens and current deployment boundaries.

## Hosting

Kavach uses the Vercel hosting details supplied by the project owner:

- Primary domain: https://kavach-plum-one.vercel.app/
- Deployment URL: https://kavach-r5vprn7s3-virtualraghu1-1039s-projects.vercel.app/
- Deployment dashboard: https://vercel.com/virtualraghu1-1039s-projects/kavach/8DZEpTXfCUVUWUEZ2MUjtEdADF8N
- Vercel project: `kavach`
- Vercel team scope: `virtualraghu1-1039s-projects`

The Vercel project is connected to `virtualraghu1/kavach`, with `main` as the
production branch. Root-level `vercel.json` installs dependencies in `admin/`,
runs type checking, lint, tests and the build, and serves `admin/dist/client`.
Production uses project-scoped Vercel environment variables for the Kavach
Supabase URL and public publishable key. Only fictional data should be entered
until the new migration/function have been approved for a development or staging
environment and the end-to-end authorization fixtures pass.

## Database

Kavach uses the Supabase project designated by the project owner:

- Organisation: `Wellness of women private limited` (`faxhpalwqhkhfsysmalv`)
- Project reference: `ldexvxjccihecrclirof`
- Dashboard: https://supabase.com/dashboard/project/ldexvxjccihecrclirof

The Phase 2 branches contain the Supabase CLI configuration, the
accounts/membership schema and a server-side username/email sign-in service. The
first three database migrations were applied to the confirmed replacement
Kavach project on 14 September 2026. The web account-management migration and
version 3 of the reviewed Edge Function were deployed on 15 September 2026,
together with the production web login and role workspaces. Public Auth signup
is closed and the hosted password policy is length-only with a six-character
minimum. The first username-only owner account was bootstrapped and verified on
15 September 2026; no staff or resident fixtures have been created. See
[`docs/phase2-database-migration.md`](docs/phase2-database-migration.md) for
database evidence and [`docs/authentication-design.md`](docs/authentication-design.md)
for the no-email identity, throttling and deployment boundaries.

The following local-only slice adds secure society-administrator provisioning:
the owner issues a short-lived code, the administrator privately sets a password
and the account activates on first sign-in. Its migration, Edge Function and web
UI are implemented and tested against local Supabase on Colima, but have not
been applied or deployed to production. See
[`docs/staff-setup-slice.md`](docs/staff-setup-slice.md) for evidence and rollout
requirements.

Phase One of the next account-access milestone now includes a controlled,
production-locked first-owner bootstrap migration and command. An earlier
staging-branch attempt in the former Free organisation was rejected before
creation. The replacement organisation is Pro; no branch was created as part of
this connection switch. See
[`docs/phase-one-owner-bootstrap.md`](docs/phase-one-owner-bootstrap.md) for the
environment decision, implemented safeguards and production execution record.

## Project materials

The local workspace contains design mockups in `mockups/`, a business-plan
generator in `generate_kavach_business_plan.py`, and a business-plan PDF in
`output/pdf/`.

These materials are pending upload: at repository setup, the local files were
iCloud placeholders and macOS could not download their contents because of
insufficient disk space. The Phase 1 admin application is now included;
unrelated project materials remain local.

Temporary working files, local environments, and secrets are excluded from Git.
