# Kavach

Project workspace for Kavach, a community SOS concept.

## Phase 1 admin prototype

The working local enrollment demo is in [`admin/`](admin/README.md). It uses fictional residents and simulated phone acknowledgement, with no external services connected. See its README for run commands, tested workflows and phase boundaries.

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
Supabase URL and public publishable key. Only fictional data should be entered:
the current enrollment repository remains browser-local and is not yet shared
across devices.

## Database

Kavach uses the Supabase project designated by the project owner:

- Organisation: `Wellness of women private limited` (`faxhpalwqhkhfsysmalv`)
- Project reference: `ldexvxjccihecrclirof`
- Dashboard: https://supabase.com/dashboard/project/ldexvxjccihecrclirof

The Phase 2 feature branch contains the Supabase CLI configuration, the
accounts/membership schema and a local server-side username/email sign-in
service. All three database migrations were applied to the confirmed replacement
Kavach project on 14 September 2026. The reviewed sign-in Edge Function was
deployed to that project on the same date. No Auth users or resident fixtures
were created. See
[`docs/phase2-database-migration.md`](docs/phase2-database-migration.md) for
database evidence and [`docs/authentication-design.md`](docs/authentication-design.md)
for the no-email identity, throttling and deployment boundaries.

Phase One of the next account-access milestone now includes a controlled,
production-locked first-owner bootstrap migration and command. An earlier
staging-branch attempt in the former Free organisation was rejected before
creation. The replacement organisation is Pro; no branch was created as part of
this connection switch. See
[`docs/phase-one-owner-bootstrap.md`](docs/phase-one-owner-bootstrap.md) for the
environment decision, implemented safeguards and remaining execution gate.

## Project materials

The local workspace contains design mockups in `mockups/`, a business-plan
generator in `generate_kavach_business_plan.py`, and a business-plan PDF in
`output/pdf/`.

These materials are pending upload: at repository setup, the local files were
iCloud placeholders and macOS could not download their contents because of
insufficient disk space. The Phase 1 admin application is now included;
unrelated project materials remain local.

Temporary working files, local environments, and secrets are excluded from Git.
