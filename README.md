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
No environment variables or database connection are required for this demo.
Only fictional data should be entered: records are browser-local, not protected
by real administrator authentication or shared across devices.

## Database

Kavach uses the Supabase project designated by the project owner:

- Project reference: `xvzymtkfzkoskljcexai`
- Dashboard: https://supabase.com/dashboard/project/xvzymtkfzkoskljcexai

The Phase 2 feature branch contains the Supabase CLI configuration, the
accounts/membership schema and a local server-side username/email sign-in
service. Both database migrations were applied to the confirmed Kavach project
on 14 September 2026. The reviewed sign-in Edge Function was deployed to that
project on the same date and verified with fictional invalid credentials. No
Auth users or resident fixtures were created. See
[`docs/phase2-database-migration.md`](docs/phase2-database-migration.md) for
database evidence and [`docs/authentication-design.md`](docs/authentication-design.md)
for the no-email identity, throttling and deployment boundaries.

## Project materials

The local workspace contains design mockups in `mockups/`, a business-plan
generator in `generate_kavach_business_plan.py`, and a business-plan PDF in
`output/pdf/`.

These materials are pending upload: at repository setup, the local files were
iCloud placeholders and macOS could not download their contents because of
insufficient disk space. The Phase 1 admin application is now included;
unrelated project materials remain local.

Temporary working files, local environments, and secrets are excluded from Git.
