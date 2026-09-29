import { useState } from "react";
import type { Workspace } from "./accountApi";

export function AddResidentForm({ workspace, onClose, onSave }: { workspace: Workspace; onClose: () => void; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return <section className="profile-card resident-setup-panel" aria-label="Add resident">
    <h2>Add a community member</h2>
    {saved ? <><p role="status">Resident added. Open Account setup to issue their enrollment QR or set up their account.</p><button className="primary" onClick={onClose}>Done</button></> : <form onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      const data = new FormData(event.currentTarget);
      setBusy(true); setError("");
      try { await onSave({ requestId, communityId: data.get("communityId"), fullName: data.get("fullName"), houseNumber: data.get("houseNumber"), block: data.get("block"), category: data.get("category"), verificationReason: data.get("verificationReason"), verified: data.get("verified") === "on", consent: data.get("consent") === "on" }); setSaved(true); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add resident."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, display: "grid", gap: 16 }}>
        <label className="field"><span>Community</span><select name="communityId" required>{workspace.communities.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
        <label className="field"><span>Full name</span><input name="fullName" required minLength={2} maxLength={160} /></label>
        <label className="field"><span>House number</span><input name="houseNumber" required maxLength={40} /></label>
        <label className="field"><span>Block (optional)</span><input name="block" maxLength={80} /></label>
        <label className="field"><span>Member type</span><select name="category"><option value="senior">Senior</option><option value="community_member">Community member</option></select></label>
        <label className="field"><span>Verification note</span><input name="verificationReason" required minLength={3} maxLength={500} placeholder="How identity was checked against community records" /></label>
        <label><input name="verified" type="checkbox" required /> Identity checked against community records</label>
        <label><input name="consent" type="checkbox" required /> Resident has agreed to enrollment</label>
        {error && <p role="alert" className="error-bar">{error}</p>}
        <div className="dialog-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">{busy ? "Adding resident…" : "Add resident"}</button></div>
      </fieldset>
    </form>}
  </section>;
}

