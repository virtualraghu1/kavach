# Web authentication and user-management slice

Status: deployed to the confirmed Kavach production stack on 15 September 2026.

## Existing versus missing inventory

Before this slice, Kavach already had a Vite/React admin prototype, a separate
Supabase project, account/membership tables, private login identifiers, the
three trusted roles, read-oriented RLS policies, a controlled owner bootstrap,
and a sign-in-only Edge Function. The visible admin UI still used fictional
`localStorage` records and simulated pairing. There were no Auth users, no live
resident fixtures, no default login gate, no authenticated workspace endpoint,
and no role-specific user-management screens.

This slice adds the default login gate, secure session restoration, protected
workspace loading, owner/community-staff/resident web views, and narrow owner
mutations. It also closes an account-link visibility gap for owners and makes an
inactive community immediately unavailable to ordinary community roles.

## Server contract

`account-api` supports:

- public `sign_in`;
- authenticated `workspace`;
- owner-only `create_community`;
- owner-only `set_community_status`; and
- owner-only `set_staff_account_status`.

Every authenticated action validates the Supabase user and exact session, then
loads the active account and trusted database roles. The service-role client is
server-only. Browser responses are `no-store`, origins are allowlisted, and
mutations write security events.

## Production rollout

The explicitly approved rollout applied these components together:

1. `20260914164728_web_auth_user_management.sql`;
2. the updated `account-api` function;
3. the production Vercel build; and
4. exact `KAVACH_ALLOWED_ORIGINS` configuration for the chosen preview or
   production URL.

Hosted public signup is closed and the hosted password policy is length-only
with a six-character minimum.
Before using real residents, create isolated fictional owner, staff, resident
and second-community fixtures. Verify
cross-community denial, disabled-account denial and session revocation through
direct API requests—not only through the UI.

## Verified

- TypeScript type check and ESLint.
- Web unit tests and production build.
- Vercel Sites packaging tests.
- Deno formatting, type check and server-helper unit tests.
- Browser checks at 1440 x 900 and 390 x 844 for login, account-help,
  owner-management, staff-resident and resident-profile views.
- No horizontal overflow or relevant browser console errors in those checks.
- The production Vercel build completed the same type check, lint, 22 web tests
  and production build before release.
- The live production login rendered at desktop and 390 x 844, had no horizontal
  overflow or browser console errors, and returned the expected generic error
  for fictional invalid credentials.
- The live Edge Function allowed the exact Kavach production origin, rejected an
  unrelated origin, and returned `no-store` responses.

The successful username/password workflow was not executed because no fictional
Auth fixtures exist. No production user was created as part of deployment.

## Visual fidelity ledger

- Preserved the accepted red shield, off-white/white surfaces, dark headings,
  coral actions, green success states and rounded rows.
- Preserved the reference login hierarchy and exact primary fields; used a
  two-column desktop frame to add calm account context without crowding the
  form. Mobile collapses to one column.
- Preserved the owner sidebar, account header and community-first hierarchy.
- Kept administrators and residents as separate management views so future
  communities do not mix role assignments into resident identity records.
- Kept profile images for the fictional BHEL preview residents and staff;
  real records without an image use readable initials.
- Replaced the concept's immediately active “Add society administrator” flow
  with an explicit secure-setup notice until single-use grants are implemented.
  This is an intentional security deviation, not a simulated success.

Sanitised local screenshots are stored in `admin/qa/auth-*.png`. They use only
fictional preview data.
