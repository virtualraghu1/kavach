# Kavach build 3 — design and functional QA

Reviewed 14 September 2026. Result: **Passed for the local frontend-demo scope.** This is not production emergency-system certification.

## Reference and visual review

Reference: user-supplied `Codex Image Sep 14, 2026, 09_23_12 AM.png` (1487 × 1058).
Compared the reference and `qa/desktop-normalized.png` side by side at matching dimensions. The final implementation preserves the sidebar, central resident queue, right activation panel, off-white surface, red actions, green verification states, and supplied fictional portraits. Source shield artwork and office portrait replaced temporary placeholders during review.

Functional additions intentionally change vertical spacing: persistent demo notice, search/filter controls, Add resident, and a phone-connection simulator. Confirmation is deliberately disabled before acknowledgement, unlike the static reference. The desktop queue scrolls to reach all eight ready residents; the document scrolls when the activation panel exceeds viewport height.

Evidence:
- `qa/desktop-final.png` and `qa/desktop-normalized.png`: final desktop composition.
- `qa/tablet.png`: 834 CSS-pixel tablet layout.
- `qa/mobile-list.png`, `qa/mobile-activation.png`, `qa/mobile-form.png`: 390 × 844 CSS-pixel mobile layout, activation, and modal.

No horizontal overflow was observed at desktop, tablet, or mobile sizes. Mobile selection focuses and brings the activation panel into view. Form content remains scrollable. Full-size comparison text was readable; no additional detail crop was necessary. Minor residual differences are font rasterization, source portrait resolution, and browser screenshot colour rendering. CSS red was verified as rgb(230, 39, 43). Screenshots were captured at the browser's existing 80% zoom, with viewport dimensions adjusted for the intended CSS sizes; the viewport override was reset afterward.

## Functional checks performed

- Seed counts: 8 ready, 3 completed today, 2 needing details, 15 total records.
- Add a name-only draft, find it, edit required details, and explicitly verify all three checklist items.
- Verification and resident edits survive refresh.
- Confirmation is disabled before simulated acknowledgement; completion updates counts once.
- Different residents retain distinct pairing sessions; revisiting and refresh preserve unexpired sessions.
- Empty search state and clear-filter recovery work.
- Deactivation requires confirmation and produces an inactive record.
- Active SOS clearly states that live monitoring is unavailable.
- Reset requires confirmation and restores fictional fixtures; final preview is reset to initial counts.
- Native dialogs, disabled controls, labels, skip link, focus handling, and mobile forms were checked.

## Automated verification

- TypeScript check: passed.
- ESLint: passed.
- Vitest: 19 tests passed, including expiry, revocation, stale sessions, single-use completion, verification invalidation, malformed storage recovery, write-failure fallback, counts, and normalization.
- Production build: passed. Rollup reported two non-blocking upstream Zod comment-annotation warnings.
- Starter packaging tests: 4 passed. No hosting deployment was performed.

The browser log retained transient Vite hot-reload errors from an intermediate edit. The final refreshed page rendered successfully with expected controls and counts; the latest inspected log entries were those historical errors, not new runtime errors. This does not claim a globally empty browser console.

## Boundaries

All records and codes are demo data stored in this browser. Phone acknowledgement is simulated. No actual authentication, backend access control, phone pairing, notification delivery, GPS, SMS, or SOS dispatch has been implemented or tested. Production integration and real-device accessibility/usability testing remain future work.
