import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  DeviceMobile,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Avatar, Notice, Step } from "./components";
import {
  currentPairing,
  isVerified,
  statusOf,
  type DemoState,
  type Resident,
} from "./domain";
import { repository } from "./repository";

export function ActivationPanel({
  resident: r,
  state,
  now,
  onView,
  onNext,
  onBack,
  run,
}: {
  resident?: Resident;
  state: DemoState;
  now: number;
  onView: () => void;
  onNext: () => void;
  onBack: () => void;
  run: (fn: () => void, message?: string) => void;
}) {
  if (!r)
    return (
      <aside className="activation-panel empty">
        <DeviceMobile size={42} />
        <h2>Select a resident</h2>
        <p>Choose a profile to see the next enrollment step.</p>
      </aside>
    );
  const status = statusOf(state, r),
    session = currentPairing(state, r.id),
    expired = !!session && session.expiresAt <= now;
  const eligible = status === "Ready to activate",
    completed = status === "Completed",
    valid =
      eligible &&
      !!session &&
      !expired &&
      ["pending", "acknowledged"].includes(session.state);
  const seconds = session
    ? Math.min(600, Math.max(0, Math.ceil((session.expiresAt - now) / 1000)))
    : 0;
  return (
    <aside className="activation-panel" aria-label="Phone activation">
      <button className="text-button mobile-back" onClick={onBack}>
        <ArrowLeft /> Back to residents
      </button>
      <div className="panel-heading">
        <h2 tabIndex={-1}>
          {completed
            ? "Enrollment complete"
            : `Activate ${r.name.split(" ")[0]}’s phone`}
        </h2>
        <p>
          {completed
            ? "Demo setup has been recorded."
            : `Help ${r.name.split(" ")[0]} connect Kavach on their phone.`}
        </p>
      </div>
      <div className="identity">
        <Avatar resident={r} large />
        <div>
          <h3>{r.name}</h3>
          <p>House No. {r.house || "Not entered"}</p>
          <p>
            {r.age && `Age ${r.age} · `}
            {r.category}
          </p>
        </div>
      </div>
      {completed ? (
        <div className="completed-panel">
          <CheckCircle size={60} weight="fill" />
          <h3>Demo activation completed</h3>
          <p>No physical phone has been linked.</p>
          <button className="primary" onClick={onNext}>
            Activate next resident <ArrowRight size={20} />
          </button>
          <button className="text-button" onClick={onView}>
            View resident & activity
          </button>
        </div>
      ) : !eligible ? (
        <div className="blocked-panel">
          <ShieldCheck size={38} />
          <h3>{status}</h3>
          <p>
            {status === "Waiting for phone"
              ? "This resident is enrolled and needs help finding a supported phone."
              : status === "Inactive"
                ? "This resident is inactive. Phone activation is unavailable."
                : "Complete the resident’s details, consent and membership verification before pairing."}
          </p>
          <button className="secondary" onClick={onView}>
            Review resident
          </button>
        </div>
      ) : (
        <>
          <div className="pairing-label">
            <h3>Pairing code</h3>
            <span className="demo-tag">DEMO</span>
          </div>
          {session ? (
            <div className={`code-box ${expired ? "expired" : ""}`}>
              <div
                className="pairing-code"
                aria-label={
                  expired
                    ? "Pairing code expired"
                    : `Pairing code ${session.code}`
                }
              >
                {expired
                  ? "Expired"
                  : session.code.slice(0, 3) + " " + session.code.slice(3)}
              </div>
              <p>
                {expired ? (
                  "Generate a new code to continue."
                ) : (
                  <>
                    Expires in{" "}
                    <strong>
                      {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                      {String(seconds % 60).padStart(2, "0")}
                    </strong>
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="code-box">
              <DeviceMobile size={34} />
              <p>Prepare a code for this resident.</p>
              <button
                className="secondary"
                onClick={() => run(() => repository.generate(r.id))}
              >
                Generate pairing code
              </button>
            </div>
          )}
          <p className="pairing-instructions">
            Open Kavach on {r.name.split(" ")[0]}’s phone and enter this code.
          </p>
          <div className="steps">
            <Step done={isVerified(state, r)} label="Resident verified">
              Identity confirmed in person
            </Step>
            <Step
              done={session?.state === "acknowledged"}
              label={
                session?.state === "acknowledged"
                  ? "Demo phone acknowledged"
                  : "Phone connected"
              }
            >
              {session?.state === "acknowledged"
                ? "Ready for admin confirmation"
                : "Waiting for acknowledgement"}
            </Step>
          </div>
          <div className="simulation">
            <button
              className="secondary"
              disabled={!valid || session?.state === "acknowledged"}
              onClick={() =>
                run(
                  () => repository.acknowledge(r.id, session!.id),
                  "Demo acknowledgement received.",
                )
              }
            >
              <DeviceMobile size={19} /> Simulate phone connection
            </button>
            <p>Demo connection only. No physical phone has been linked.</p>
          </div>
          <button
            className="primary confirm-phone"
            disabled={!valid || session?.state !== "acknowledged"}
            onClick={() =>
              run(
                () => repository.complete(r.id, session!.id),
                "Demo enrollment completed.",
              )
            }
          >
            Confirm phone connected <ArrowRight size={18} />
          </button>
          <Notice>The code works once. Do not send it by message.</Notice>
          {session && (
            <button
              className="text-button regenerate"
              onClick={() =>
                run(
                  () => repository.generate(r.id, true),
                  "A new demo code is ready.",
                )
              }
            >
              <ArrowsClockwise size={17} /> Generate a new code
            </button>
          )}
          <button className="text-button review-link" onClick={onView}>
            View profile & verification
          </button>
        </>
      )}
    </aside>
  );
}
