import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ShieldCheck, X, WarningCircle } from "@phosphor-icons/react";
import type { Resident } from "./domain";

export function Avatar({
  resident,
  large = false,
}: {
  resident: Pick<Resident, "name" | "avatar">;
  large?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={`avatar ${large ? "avatar-large" : ""}`}
      aria-hidden="true"
    >
      {resident.avatar && !broken ? (
        <img src={resident.avatar} alt="" onError={() => setBroken(true)} />
      ) : (
        resident.name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
      )}
    </span>
  );
}
export function Verified({ label = "Identity verified" }: { label?: string }) {
  return (
    <span className="verified">
      <ShieldCheck size={31} weight="fill" />
      <span>{label}</span>
    </span>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "notice-error" : ""}`}
      role={error ? "alert" : undefined}
    >
      <WarningCircle size={21} weight="fill" />
      <span>{children}</span>
    </div>
  );
}
export function Step({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="step">
      <span className={`step-dot ${done ? "done" : ""}`}>
        {done ? <Check size={20} weight="bold" /> : "2"}
      </span>
      <div>
        <strong className={done ? "green" : ""}>{label}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const prior = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={23} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
