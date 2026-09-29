import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, QrCode } from "@phosphor-icons/react";
import { requestResidentQrEnrollment } from "./accountApi";
import { parseResidentQr } from "./residentQr";

export function ResidentQrEnrollment({ initialToken = "", onBack }: { initialToken?: string; onBack: () => void }) {
  const [token, setToken] = useState(initialToken);
  const [manual, setManual] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!scanning) return;
    let disposed = false;
    const element = video.current;
    void import("@zxing/browser").then(async ({ BrowserQRCodeReader }) => {
      if (disposed || !element) return;
      const reader = new BrowserQRCodeReader();
      const active = await reader.decodeFromConstraints({ video: { facingMode: "environment" }, audio: false }, element, (result, _error, scanner) => {
        if (disposed || !result) return;
        const parsed = parseResidentQr(result.getText(), location.origin);
        scanner.stop();
        setScanning(false);
        if (parsed) { setToken(parsed); setError(""); }
        else setError("This is not an enrollment QR for this Kavach site. Ask your community office for the correct QR.");
      });
      if (disposed) active.stop(); else controls.current = active;
    }).catch(() => { if (!disposed) { setScanning(false); setError("The camera could not be opened. Allow camera access, choose a QR image, or enter the enrollment code below."); } });
    const hide = () => { if (document.hidden) setScanning(false); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", hide);
      controls.current?.stop(); controls.current = null;
      const stream = element?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    };
  }, [scanning]);

  async function readImage(file?: File) {
    if (!file) return;
    setScanning(false); setBusy(true); setError("");
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      const parsed = parseResidentQr(result.getText(), location.origin);
      if (!parsed) throw new Error("Choose an enrollment QR issued by this Kavach site.");
      setToken(parsed);
    } catch (reason) { setError(reason instanceof Error && reason.message ? reason.message : "No readable QR was found. Try a clearer image."); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  }

  return <div className="account-help qr-enrollment">
    <span className="help-icon"><QrCode size={34} /></span>
    <h1 id="auth-title">{submitted ? "Awaiting admin approval" : token ? "Request resident access" : "Scan your resident QR"}</h1>
    {submitted ? <div role="status" className="qr-request-success">
      <CheckCircle size={44} weight="fill" />
      <p>Your request for <strong>@{username}</strong> has been sent to your community office.</p>
      <p>After checking your identity, an admin will approve your request and give you a private setup code. You can then choose your password using “Set up my account.”</p>
    </div> : <>
      <p>{token ? "Choose a username for your account. Your community admin must approve this request before you can set a password and sign in." : "Use the unique QR issued for you by your community office."}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {token ? <form className="auth-form" onSubmit={event => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setError("");
        void requestResidentQrEnrollment(token, username.trim().toLowerCase())
          .then(() => { setUsername(username.trim().toLowerCase()); setSubmitted(true); setToken(""); })
          .catch(reason => setError(reason instanceof Error ? reason.message : "Your request could not be submitted."))
          .finally(() => setBusy(false));
      }}>
        <label className="field"><span>Choose a username</span><input value={username} onChange={event => setUsername(event.target.value.toLowerCase())} autoCapitalize="none" autoComplete="username" spellCheck={false} pattern="[a-z][a-z0-9._\-]{3,31}" minLength={4} maxLength={32} required disabled={busy} /><small>4–32 characters. Start with a letter; use letters, numbers, dots, underscores or hyphens.</small></label>
        <label className="qr-confirm"><input type="checkbox" required disabled={busy} />This QR was issued for me, and I am requesting access to my resident account.</label>
        <button className="primary auth-submit" disabled={busy}>{busy ? "Sending request…" : "Request admin approval"}</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setToken(""); setError(""); }}>Use a different QR</button>
      </form> : <div className="qr-scan-options">
        {scanning && <div className="qr-camera"><video ref={video} muted playsInline autoPlay aria-label="Resident QR camera preview" /><p>Point your camera at the QR code.</p></div>}
        <button className="primary" disabled={busy} onClick={() => { setError(""); setScanning(value => !value); }}><Camera size={22} />{scanning ? "Stop camera" : "Start camera scanner"}</button>
        <label className="field"><span>Or choose a QR image</span><input type="file" accept="image/*" disabled={busy || scanning} onChange={event => { void readImage(event.target.files?.[0]); event.target.value = ""; }} /></label>
        <details><summary>Enter an enrollment link or code</summary><form className="auth-form" onSubmit={event => { event.preventDefault(); const parsed = parseResidentQr(manual, location.origin); if (parsed) { setToken(parsed); setScanning(false); setError(""); } else setError("Enter a valid enrollment link or code issued by this Kavach site."); }}>
          <label className="field"><span>Enrollment link or code</span><input value={manual} onChange={event => setManual(event.target.value)} autoComplete="off" spellCheck={false} required /></label><button className="secondary" disabled={busy}>Continue</button>
        </form></details>
      </div>}
    </>}
    <button className="secondary auth-back" disabled={busy} onClick={onBack}>Back to sign in</button>
  </div>;
}
