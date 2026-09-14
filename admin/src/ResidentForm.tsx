import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import {
  duplicateOf,
  requiredErrors,
  type DemoState,
  type Resident,
} from "./domain";
import { Dialog, Notice } from "./components";

export function ResidentForm({
  resident,
  state,
  onClose,
  onSave,
}: {
  resident: Resident;
  state: DemoState;
  onClose: () => void;
  onSave: (r: Resident, verify: boolean) => void;
}) {
  const [form, setForm] = useState(resident),
    [errors, setErrors] = useState<Record<string, string>>({});
  const update = (key: keyof Resident, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));
  const duplicate = duplicateOf(state, form);
  const save = (verify: boolean) => {
    const found = verify
      ? requiredErrors(form)
      : {
          ...(!form.name.trim()
            ? { name: "Enter a name to save a draft." }
            : {}),
        };
    setErrors(found);
    if (!Object.keys(found).length) onSave(form, verify);
  };
  const field = (
    label: string,
    key: keyof Resident,
    optional = false,
    type = "text",
  ) => (
    <label className="field">
      <span>
        {label}
        {optional && <small>Optional</small>}
      </span>
      <input
        type={type}
        value={String(form[key] ?? "")}
        onChange={(e) => update(key, e.target.value)}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `error-${key}` : undefined}
      />
      {errors[key] && <em id={`error-${key}`}>{errors[key]}</em>}
    </label>
  );
  return (
    <Dialog
      title={
        state.residents.some((r) => r.id === resident.id)
          ? "Edit resident"
          : "Add a colony resident"
      }
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
        noValidate
      >
        <p className="dialog-intro">
          {state.community.name} · Fictional demo details only
        </p>
        <fieldset>
          <legend>Resident details</legend>
          <div className="form-grid">
            {field("Full name", "name")}
            {field("House / flat number", "house")}
            {field("Block / street", "block", true)}
            {field("Mobile number (+91)", "phone", false, "tel")}
            <label className="field">
              <span>Resident category</span>
              <select
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
              >
                <option>Senior</option>
                <option>Community member</option>
              </select>
            </label>
            {field("Age", "age", true, "number")}
            <label className="field">
              <span>
                Preferred language <small>Optional</small>
              </span>
              <select
                value={form.language}
                onChange={(e) => update("language", e.target.value)}
              >
                <option value="">Not specified</option>
                {[
                  "Telugu",
                  "English",
                  "Hindi",
                  "Tamil",
                  "Kannada",
                  "Malayalam",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Phone access</span>
              <select
                value={form.phoneAccess}
                onChange={(e) => update("phoneAccess", e.target.value)}
              >
                {[
                  "Own smartphone",
                  "Shared or caregiver phone",
                  "No smartphone yet",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        {form.phoneAccess === "No smartphone yet" && (
          <Notice>
            This resident can be enrolled. Phone activation will wait until a
            supported phone is available.
          </Notice>
        )}
        <fieldset>
          <legend>
            Emergency contact <small>Optional</small>
          </legend>
          <div className="form-grid">
            {field("Contact name", "contactName", true)}
            {field("Relationship", "relationship", true)}
            {field("Contact phone (+91)", "contactPhone", true, "tel")}
          </div>
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(e) => update("consent", e.target.checked)}
          />
          <span>
            The resident consents to enrollment and use of these details for the
            community-safety service.
          </span>
        </label>
        {errors.consent && <p className="field-error">{errors.consent}</p>}
        {duplicate && (
          <Notice>
            A profile with this name and house already exists. Review{" "}
            {duplicate.name} before adding another person. A shared phone number
            is allowed.
          </Notice>
        )}
        <p className="small muted">
          Saving a profile does not verify membership. Changes to name, address,
          phone access or consent require verification again.
        </p>
        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => save(false)}
          >
            Save draft
          </button>
          <button className="primary" type="submit">
            Save & continue to verification <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
