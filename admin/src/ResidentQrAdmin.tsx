import { useCallback, useEffect, useState } from "react";
import { QrCode } from "@phosphor-icons/react";
import { createResidentQr, listResidentQrRequests, reviewResidentQrRequest, type ResidentQrRequest, type ResidentSetupGrant, type WorkspaceResident } from "./accountApi";
import { Dialog } from "./components";
import { residentQrUrl } from "./residentQr";

export function ResidentQrIssuer({ resident, accessToken, onClose }: { resident: WorkspaceResident; accessToken?: string; onClose: () => void }) {
  const [image, setImage] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const issue = async () => {
    if (!accessToken || busy) return;
    setBusy(true); setError("");
    try {
      const { default: QRCode } = await import("qrcode");
      const qr = await createResidentQr(resident.id, accessToken);
      setImage(await QRCode.toDataURL(residentQrUrl(qr.token, location.origin), { width: 400, margin: 3, errorCorrectionLevel: "M" }));
      setExpiry(qr.expiresAt);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The QR could not be generated."); }
    finally { setBusy(false); }
  };
  return <Dialog title="Resident enrollment QR" onClose={() => { if (!busy) onClose(); }}>
    <div className="qr-issued">
      <h2>{resident.fullName}</h2><p>House No. {resident.houseNumber}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {image ? <>
        <img className="resident-qr-image" src={image} alt={`Enrollment QR for ${resident.fullName}`} />
        <p>Open Kavach’s sign-in page on the resident’s phone and choose <strong>Scan resident QR</strong>.</p>
        <p>Valid until {new Date(expiry).toLocaleString("en-IN")}. The QR accepts one request. An admin must approve it before account setup.</p>
        <a className="secondary" download={`kavach-enrollment-${resident.id}.png`} href={image}>Download QR</a>
      </> : <>
        <QrCode size={68} />
        <p>Create a unique QR for this resident. It expires in 7 days and replaces any earlier unused QR.</p>
        <p>The resident chooses a username after scanning. Their request then appears in “Enrollment requests” for review.</p>
        <button className="primary" disabled={busy || !accessToken} onClick={() => void issue()}>{busy ? "Creating QR…" : "Create resident QR"}</button>
      </>}
      <button className="secondary" disabled={busy} onClick={onClose}>Done</button>
    </div>
  </Dialog>;
}

export function ResidentQrRequests({ accessToken, preview, residents, onRefresh }: { accessToken?: string; preview: boolean; residents: WorkspaceResident[]; onRefresh: () => Promise<void> }) {
  const [requests, setRequests] = useState<ResidentQrRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ResidentQrRequest | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<ResidentSetupGrant | null>(null);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    if (!accessToken || preview) return;
    setLoading(true); setError("");
    try { setRequests(await listResidentQrRequests(accessToken)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enrollment requests could not be loaded."); }
    finally { setLoading(false); }
  }, [accessToken, preview]);
  useEffect(() => { void refresh(); }, [refresh]);
  const review = async (decision: "approve" | "reject") => {
    if (!selected || !accessToken || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const grant = await reviewResidentQrRequest(selected.id, decision, accessToken);
      setRequests(current => current.filter(item => item.id !== selected.id));
      setSetup(grant);
      if (!grant) { setSelected(null); setNotice("Request rejected. No account was created."); }
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The request could not be reviewed."); }
    finally { setBusy(false); }
  };
  const target = residents.find(item => item.id === selected?.residentId);
  const eligible = !!target && target.accountStatus === "not_created" && target.verified && target.consentRecorded && target.membershipStatus === "active" && target.profileStatus === "active";
  return <section className="profile-card qr-requests" aria-label="Enrollment requests">
    <div className="card-heading-row"><div><h2>Enrollment requests</h2><p>Residents who scanned their QR and are waiting for your approval.</p></div><button className="secondary" disabled={loading || busy || preview} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh requests"}</button></div>
    {error && !selected && <p className="notice notice-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !error && !requests.length && <p className="muted">No requests awaiting approval.</p>}
    {requests.map(item => <article className="qr-request-row" key={item.id}><div><strong>{item.fullName}</strong><p>House No. {item.houseNumber} · Requested @{item.username}</p><small>{new Date(item.requestedAt).toLocaleString("en-IN")}</small></div><button className="secondary" disabled={busy} onClick={() => { setSelected(item); setConfirmed(false); setSetup(null); setError(""); }}>Review request</button></article>)}
    {requests.length === 100 && <p className="muted">Showing the oldest 100 requests. Review these and refresh to see more.</p>}
    {selected && <Dialog title={setup ? "Approved — resident setup code" : "Review enrollment request"} onClose={() => { if (!busy) { setSelected(null); setSetup(null); } }}>
      <h2>{selected.fullName}</h2><p>House No. {selected.houseNumber} · @{selected.username}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {setup ? <>
        <div className="code-box" role="status"><strong>In-person setup code</strong><div className="pairing-code">{setup.code.slice(0, 3)} {setup.code.slice(3)}</div><p>Username: {setup.username}</p><p>Expires at {new Date(setup.expiresAt).toLocaleTimeString("en-IN")}</p></div>
        <p>Give this code to the resident in person. They choose “Set up my account” on the sign-in page and set their own password. The code works once.</p>
        <button className="primary" onClick={() => { setSelected(null); setSetup(null); }}>Done</button>
      </> : <>
        <p>Check that the person requesting access is this resident. Approval prepares their account and creates a private password-setup code.</p>
        {!eligible && <p className="notice notice-error">An active membership, recorded consent, verified identity and no existing account are required. Review the resident record before approval.</p>}
        <label className="qr-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} />I have checked the resident’s identity in person and approve this account request.</label>
        <div className="dialog-actions"><button className="secondary danger" disabled={busy} onClick={() => void review("reject")}>Reject request</button><button className="primary" disabled={busy || !confirmed || !eligible} onClick={() => void review("approve")}>{busy ? "Saving decision…" : "Approve and issue setup code"}</button></div>
      </>}
    </Dialog>}
  </section>;
}
