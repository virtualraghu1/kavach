import { useState } from "react";
import { Avatar, Dialog, Notice, Verified } from "./components";
import {
  isVerified,
  requiredErrors,
  statusOf,
  type DemoState,
  type Resident,
} from "./domain";
import { repository } from "./repository";

export function ResidentDetail({
  resident: r,
  state,
  onClose,
  onEdit,
  run,
}: {
  resident: Resident;
  state: DemoState;
  onClose: () => void;
  onEdit: () => void;
  run: (fn: () => void, message?: string) => void;
}) {
  const [checks, setChecks] = useState([false, false, false]),
    [confirm, setConfirm] = useState<"deactivate" | "withdraw" | null>(null);
  const missing = Object.values(requiredErrors(r)),
    verified = isVerified(state, r);
  const verification = state.verifications.findLast(
    (v) => v.residentId === r.id && v.valid,
  );
  return (
    <Dialog title="Resident profile & verification" onClose={onClose} wide>
      <div className="identity">
        <Avatar resident={r} large />
        <div>
          <h3>{r.name}</h3>
          <p>House No. {r.house || "Not entered"}</p>
          <p>
            {r.age && `Age ${r.age} · `}
            {r.category}
          </p>
          <span className="status-chip">{statusOf(state, r)}</span>
        </div>
        <button className="secondary" onClick={onEdit}>
          Edit details
        </button>
      </div>
      <div className="detail-grid">
        <div>
          <span>Mobile · synthetic demo</span>
          <strong>{r.phone || "Not entered"}</strong>
        </div>
        <div>
          <span>Phone access</span>
          <strong>{r.phoneAccess}</strong>
        </div>
        <div>
          <span>Preferred language</span>
          <strong>{r.language || "Not specified"}</strong>
        </div>
        <div>
          <span>Emergency contact</span>
          <strong>
            {r.contactName || "Not provided"}
            {r.relationship && ` · ${r.relationship}`}
          </strong>
          <span>{r.contactPhone}</span>
        </div>
      </div>
      <h3>Community membership</h3>
      {verified ? (
        <div className="verification-success">
          <Verified label="In-person membership verified" />
          <p className="small">
            {verification?.method} · {verification?.administrator} ·{" "}
            {new Date(verification?.at || 0).toLocaleString("en-IN")}
          </p>
          <button
            className="text-button"
            onClick={() => setConfirm("withdraw")}
          >
            Withdraw verification
          </button>
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <Notice error>
              <strong>Details needed before verification</strong>
              <ul>
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Notice>
          )}
          <p className="muted">
            Check these with the resident. This records an office review, not
            phone or government-ID verification.
          </p>
          {[
            "Resident identity checked in person",
            "House/address and community membership confirmed",
            "Enrollment consent recorded",
          ].map((text, i) => (
            <label className="check-row" key={text}>
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={(e) =>
                  setChecks((v) =>
                    v.map((x, j) => (j === i ? e.target.checked : x)),
                  )
                }
              />
              <span>{text}</span>
            </label>
          ))}
          <button
            className="primary"
            disabled={!r.active || missing.length > 0 || !checks.every(Boolean)}
            onClick={() =>
              run(
                () => repository.verify(r.id, checks),
                "Community membership verified.",
              )
            }
          >
            Record verification
          </button>
        </>
      )}
      {r.phoneAccess === "No smartphone yet" && (
        <Notice>
          Assistance needed: enrolled resident has no smartphone yet. Phone
          connection is pending.
        </Notice>
      )}
      <h3 className="section-heading">Activity</h3>
      <ol className="activity-list">
        {state.activities
          .filter((a) => a.residentId === r.id)
          .slice(-8)
          .reverse()
          .map((a) => (
            <li key={a.id}>
              <strong>{a.text}</strong>
              <span>
                {a.administrator} · {new Date(a.at).toLocaleString("en-IN")}
              </span>
            </li>
          ))}
      </ol>
      {confirm ? (
        <div className="confirm-box" role="alert">
          <strong>
            {confirm === "deactivate"
              ? "Deactivate this resident?"
              : "Withdraw membership verification?"}
          </strong>
          <p>This will invalidate this resident’s pairing session.</p>
          <button className="secondary" onClick={() => setConfirm(null)}>
            Keep resident unchanged
          </button>
          <button
            className="primary"
            onClick={() => {
              run(
                () =>
                  confirm === "deactivate"
                    ? repository.deactivate(r.id)
                    : repository.invalidateVerification(r.id),
                "Resident updated.",
              );
              setConfirm(null);
            }}
          >
            Confirm {confirm === "deactivate" ? "deactivation" : "withdrawal"}
          </button>
        </div>
      ) : (
        r.active && (
          <button
            className="text-button danger"
            onClick={() => setConfirm("deactivate")}
          >
            Deactivate resident
          </button>
        )
      )}
    </Dialog>
  );
}
