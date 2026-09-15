# Kavach — secure web accounts and colony office

A React + TypeScript + Vite web application for Kavach account access and
community administration. The default route is now a Supabase-backed sign-in
screen. The original fictional enrollment prototype is retained only as an
explicit development preview.

## Run locally

Requires Node 22.12+ (verified here with Node 24).

```sh
cd admin
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open http://127.0.0.1:4173. The default screen is **Sign in to continue**.
Username/email resolution happens only in the server-side `account-api`; the
browser receives and persists the normal Supabase session.

Copy `.env.example` to `.env.local` and provide the Kavach project URL and
publishable key. Only public client configuration belongs in `VITE_` variables;
never place a Supabase secret or service-role key in the web application.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:sites
```

Production files are emitted to `dist/client`. The inherited template also
generates Sites packaging. The existing authentication workspace is deployed;
the staff setup changes in this branch are local only.

## Secure account workflows

- Username or verified email plus password sign-in through Supabase Auth.
- Generic credential errors, server-side durable throttling and exact CORS
  origin checks.
- Session restoration and server validation of the current Auth session,
  account status and revocation boundary.
- Owner workspace for all Kavach communities, society administrators and
  resident account states.
- Owner-only community creation/status changes and society-administrator
  account enable/disable actions. The server derives owner access from trusted
  role records; no client-supplied role or community ID grants access.
- Society administrators see only residents from assigned active communities.
- Residents see only their own profile, community-office help, and the explicit
  notice that emergency alerts are not enabled.
- Responsive desktop/mobile layouts with keyboard-visible focus, labelled
  password visibility, large touch controls and reduced-motion support.
- Owner-only society-administrator provisioning with a ten-minute, single-use
  setup code. The administrator chooses the permanent password privately and
  the pending account activates only after its first genuine sign-in.

Setup codes are HMAC-protected, limited to five incorrect attempts and replaced
when the owner regenerates a code. The browser receives the plain code only in
the one setup response; it is not written to the database, logs or URLs.

## Development-only previews

These URLs use fictional, in-memory render fixtures and are compiled out of the
production behavior:

- `/?preview-role=owner`
- `/?preview-role=staff`
- `/?preview-role=resident`
- `/?legacy-demo=1` for the original enrollment prototype

Preview mutations are blocked. Do not use preview screens as backend evidence.

## Legacy enrollment demo workflows

- Search by name, house or mobile; filter six enrollment states.
- Add incomplete drafts; edit details; warn on matching name + house. Multiple people can share a house or phone.
- Record explicit in-person membership verification using three checks. Optional emergency contact and language, and support for no smartphone yet.
- Separate profile completeness, valid membership verification, phone activation and activity.
- Per-resident ten-minute pairing session. Switching residents or refreshing retains an existing expiry. Expired codes require explicit regeneration.
- Separate **Simulate phone connection** control. **Confirm phone connected** stays disabled until acknowledgement. Expired, revoked, completed or ineligible sessions are rejected by the mock repository, not only by disabled buttons.
- Completing activation updates the list and counts once, clears the used code and offers the next resident.
- Editing identity/address/phone/consent/phone-access fields invalidates verification and pairing; inactive residents cannot pair.
- Activity history excludes codes. Local settings, deactivation confirmation and demo reset confirmation.
- Native accessible modal dialogs, keyboard focus, responsive desktop/tablet/mobile layouts, empty, loading, error, expiry and completed states.

## Supabase connection

The local environment is configured for Kavach project
`ldexvxjccihecrclirof`. Settings performs a no-cache Auth health request and a
read-only query for the expected `communities` table. The first three Phase 2
migrations and sign-in function were previously installed. The new
The account schema, sign-in function, web account-management migration and
owner workspace are installed in production. The staff setup-grant migration,
expanded Edge Function and updated web UI are implemented and tested locally
only. They require a separate production approval and must be released together.

## Demonstration only

No physical phone connection, OTP, SMS, push, geolocation, SOS delivery,
payments or emergency service is implemented. Existing authentication is live;
the new staff setup workflow in this branch has not been deployed.
Synthetic contacts start with `+91 000…` and must never be contacted. Profile
portraits are extracted from the user-supplied fictional mock. Other avatars
use initials.

Use **Settings → Reset demo data → Reset demo data** to restore the original 15 records: 8 ready, 3 completed today, 2 needing details, 1 awaiting verification and 1 waiting for a phone. Completed-today counts use Asia/Kolkata and change with the date.

The storage key is `kavach:admin-demo:v1`. Data has a schema version and is validated when read. Malformed data starts a fresh demonstration with a visible notice. Blocked/quota-limited storage uses memory and shows a warning. There is no cross-tab synchronization: use one tab for editing.

**Browser persistence and frontend checks are not production security controls. Do not use this prototype to enroll real residents.** Data exists only in this browser, and clearing browser storage removes it. There are no credentials or privileged keys.

## Structure

- `src/domain.ts`: typed community, administrator, resident, verification, pairing and activity models; validation and derived statuses/counts.
- `src/repository.ts`: replaceable mock repository, fixture creation, persistence and guarded transitions.
- `src/KavachApp.tsx`: secure sign-in gate and role-specific account workspaces.
- `src/accountApi.ts`: validated browser contract for the account Edge Function.
- `src/App.tsx`: retained development-only legacy enrollment demo.
- `src/ActivationPanel.tsx`: selected resident, countdown and demo connection steps.
- `src/ResidentForm.tsx`: add/edit and draft validation.
- `src/ResidentDetail.tsx`: profile review, membership checks and activity.
- `src/components.tsx`: reusable avatars, notices, modal and status components.
- `src/styles.css`: shared tokens, layout, accessible controls and responsive rules.
- `src/repository.test.ts`: behavioral tests for the enrollment and pairing lifecycle.
- `qa/`: browser screenshots; `design-qa.md`: comparison and verification report.

## Reversible design decisions

The approved composition is retained. Search, filters, the persistent demo notice and simulated acknowledgement add content beyond the image. The queue scrolls inside its desktop column so all records remain accessible and the sidebar footer stays visible. A selected resident opens a full-width activation view on small screens. Native HTML dialogs provide focus trapping and Escape dismissal. Phosphor filled icons approximate the supplied shield and navigation icons. No separate routing library was necessary for four hash routes.

Verification is intentionally withdrawn after material identity, house, phone or consent edits. For this demo, a syntactically valid 10-digit Indian phone is sufficient and synthetic 000 numbers are accepted. A resident without a smartphone can still be registered and verified, but has assistance-needed status rather than phone-connected status.

## Next implementation slices

1. **Real enrollment writes and resident setup:** replace the legacy local
   repository with allowlisted server transactions for resident details,
   consent and verification, then reuse the tested grant lifecycle for eligible
   residents.
2. **Assisted recovery:** add in-person verification, recovery grants, password
   replacement and tested session revocation without allowing staff recovery of
   privileged accounts.
3. **Resident Expo app:** reuse the account API for onboarding, sign-in, own
   profile and office help. No SOS permissions or readiness claims in this phase.
4. **Later emergency phase:** SOS delivery and responder acknowledgement only
   after reliability, privacy and device testing.

The Kavach Supabase and Vercel resources remain separate from unrelated
projects. This staff setup slice is not yet deployed publicly.
