# Resident QR enrollment

## Office workflow

1. Open Account setup and find an existing active resident without an account.
2. Choose Enrollment QR, then Create resident QR. Download or show the QR privately to that resident.
3. Resident opens the Kavach sign-in page, chooses Scan resident QR, and scans the code or selects its image. A link/code fallback is available.
4. Resident chooses a username and submits a request. No account or session is created at this stage.
5. Office staff review Enrollment requests. Verify the resident in person, then approve or reject.
6. Approval requires active membership, recorded consent, verified identity, and no existing account. It creates a private one-time account setup code.
7. Give that code to the resident in person. The resident chooses Set up my account and sets their own password.

QR codes expire after seven days and accept one request. Issuing a replacement revokes previous unused codes. Requests and account setup are scoped to the staff member's community; the owner can manage all communities. QR links from a different site are rejected. QR tokens are hashed in storage and removed from the browser address after opening.

## Verification — 29 September 2026

- Isolated release based on 1b08fe1, whose original frontend asset hashes matched the live production site.
- Production account-api v12 used as backend baseline; QR release is v13.
- Type checking, lint, all 25 unit tests, production build and Deno type checking passed.
- Pilot database transaction tested request persistence without account creation, superseded and reused codes, cross-community issue/approval denial, unverified approval denial, approval with pending account setup, repeated approval denial and client permission isolation. Fixtures rolled back.
- Browser image decoding opened the request form; rescan and admin Account setup controls inspected.
- Production API rejected nonexistent QR (409) and anonymous administrative actions (401).
- Physical phone camera and full resident password setup on a physical device remain manual acceptance checks.

Database migration: 20260929105700_resident_qr_enrollment.sql.
