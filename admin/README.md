# Kavach — Phase 1 colony office

A local React + TypeScript + Vite + Tailwind frontend prototype, based on the approved third enrollment mock. All resident data and phone connections are fictional demonstrations.

## Run locally

Requires Node 22.12+ (verified here with Node 24).

```sh
cd admin
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open http://127.0.0.1:4173. Default route is Enrollment drive. Hash navigation supports Residents, Enrollment drive, Active SOS and Settings without a server router.

Copy `.env.example` to `.env.local` and provide the Kavach project URL and
publishable key. Only public client configuration belongs in `VITE_` variables;
never place a Supabase secret or service-role key in the web application.

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Production files are emitted to `dist/client`. The inherited template also generates Sites packaging; no deployment has been performed.

## Functional workflows

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

The feature branch is configured locally for Kavach project
`xvzymtkfzkoskljcexai`. Settings performs a no-cache Auth health request and a
read-only query for the expected `communities` table. The Phase 2 schema is
installed and intentionally denies anonymous table access. The existing
enrollment repository remains browser-local until authenticated server
endpoints replace it; this avoids presenting demo flags as authoritative
account activation.

## Demonstration only

No physical phone connection, auth, server, OTP, SMS, push, geolocation, SOS delivery, payments or external service is implemented. The Active SOS page explicitly explains its later-phase status. Synthetic contacts start with `+91 000…` and must never be contacted. Profile portraits are extracted from the user-supplied fictional mock. Other avatars use initials.

Use **Settings → Reset demo data → Reset demo data** to restore the original 15 records: 8 ready, 3 completed today, 2 needing details, 1 awaiting verification and 1 waiting for a phone. Completed-today counts use Asia/Kolkata and change with the date.

The storage key is `kavach:admin-demo:v1`. Data has a schema version and is validated when read. Malformed data starts a fresh demonstration with a visible notice. Blocked/quota-limited storage uses memory and shows a warning. There is no cross-tab synchronization: use one tab for editing.

**Browser persistence and frontend checks are not production security controls. Do not use this prototype to enroll real residents.** Data exists only in this browser, and clearing browser storage removes it. There are no credentials or privileged keys.

## Structure

- `src/domain.ts`: typed community, administrator, resident, verification, pairing and activity models; validation and derived statuses/counts.
- `src/repository.ts`: replaceable mock repository, fixture creation, persistence and guarded transitions.
- `src/App.tsx`: app shell, lightweight hash navigation and page composition.
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

## Next phases (not implemented)

1. **Phase 2:** real admin authentication and database, server-enforced community permissions, consent and audit records, and resident-side activation. Pairing needs server-issued short-lived single-use sessions, attempt limits, replay protection and verified device acknowledgement. Replace the repository and enforce every transition on the server.
2. **Phase 3:** resident SOS experience, community alert delivery and responder acknowledgement, followed by a controlled pilot after reliability/privacy testing.
3. **Phase 4:** optional physical SOS buttons and other hardware integrations.

The existing workspace provider information remains separate. This build does not connect to those projects or deploy publicly.
