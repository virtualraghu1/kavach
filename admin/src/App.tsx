import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  CaretRight,
  GearSix,
  House,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  counts,
  currentPairing,
  emptyResident,
  isVerified,
  statuses,
  statusOf,
  type EnrollmentStatus,
  type Resident,
} from "./domain";
import { repository } from "./repository";
import { Avatar, Dialog, Notice, Verified } from "./components";
import { ActivationPanel } from "./ActivationPanel";
import { ResidentForm } from "./ResidentForm";
import { ResidentDetail } from "./ResidentDetail";
type Route = "enrollment" | "residents" | "sos" | "settings";
const routeFromHash = (): Route => {
  const value = location.hash.slice(1);
  return ["enrollment", "residents", "sos", "settings"].includes(value)
    ? (value as Route)
    : "enrollment";
};
export function App() {
  const state = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
  );
  const [route, setRoute] = useState<Route>(routeFromHash),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<EnrollmentStatus | "All">(
      routeFromHash() === "residents" ? "All" : "Ready to activate",
    );
  const [selected, setSelected] = useState("resident-1"),
    [mobileDetail, setMobileDetail] = useState(false),
    [form, setForm] = useState<Resident | null>(null),
    [detail, setDetail] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now()),
    [feedback, setFeedback] = useState(""),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const change = () => {
      setRoute(routeFromHash());
      setQuery("");
      setFilter(routeFromHash() === "residents" ? "All" : "Ready to activate");
      setMobileDetail(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", change);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", change);
    };
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(""), 5000);
    return () => clearTimeout(t);
  }, [feedback]);
  const run = (fn: () => void, message?: string) => {
    try {
      fn();
      setError("");
      if (message) setFeedback(message);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    }
  };
  const choose = (r: Resident) => {
    setSelected(r.id);
    setMobileDetail(true);
    if (window.matchMedia("(max-width: 700px)").matches)
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0 });
        document
          .querySelector<HTMLElement>(".panel-heading h2")
          ?.focus({ preventScroll: true });
      });
    if (
      statusOf(state, r) === "Ready to activate" &&
      !currentPairing(state, r.id)
    )
      run(() => repository.generate(r.id));
  };
  useEffect(() => {
    const s = repository.getSnapshot(),
      r = s.residents[0];
    if (r && statusOf(s, r) === "Ready to activate" && !currentPairing(s, r.id))
      repository.generate(r.id);
  }, []);
  const summary = counts(state, now),
    resident = state.residents.find((r) => r.id === selected),
    detailResident = state.residents.find((r) => r.id === detail);
  const shown = state.residents.filter(
    (r) =>
      (filter === "All" || statusOf(state, r) === filter) &&
      `${r.name} ${r.house} ${r.phone}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const next = () => {
    const r = state.residents.find(
      (r) => statusOf(state, r) === "Ready to activate" && r.id !== selected,
    );
    if (r) {
      choose(r);
      setFilter("Ready to activate");
      setQuery("");
    } else {
      setSelected("");
      setMobileDetail(false);
      setFeedback("All eligible residents have completed demo activation.");
    }
  };
  const nav = [
    { route: "residents", label: "Residents", icon: House },
    { route: "enrollment", label: "Enrollment drive", icon: UsersThree },
    { route: "sos", label: "Active SOS", icon: ShieldCheck },
    { route: "settings", label: "Settings", icon: GearSix },
  ] as const;
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src="/brand-mark.png" alt="" />
          <div>
            <strong>Kavach</strong>
            <span>{state.community.name}</span>
          </div>
        </div>
        <div className="header-right">
          <time>
            {new Intl.DateTimeFormat("en-IN", {
              dateStyle: "full",
              timeZone: "Asia/Kolkata",
            }).format(now)}
          </time>
          <div className="admin-profile">
            <Avatar
              resident={{
                name: state.administrator.name,
                avatar: "/avatars/meena.png",
              }}
            />
            <div>
              <strong>{state.administrator.name}</strong>
              <span>{state.administrator.role}</span>
            </div>
          </div>
        </div>
      </header>
      <div className="app-layout">
        <aside className="sidebar">
          <nav aria-label="Main navigation">
            {nav.map((item) => (
              <a
                key={item.route}
                href={`#${item.route}`}
                aria-current={route === item.route ? "page" : undefined}
              >
                <item.icon size={28} weight="fill" />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-footer">
            <p>
              Safer neighbours,
              <br />
              stronger communities.
            </p>
            <div className="short-rule" />
            <p>
              Kavach
              <br />
              {state.community.address}
            </p>
          </div>
        </aside>
        <main
          id="main"
          tabIndex={-1}
          className={mobileDetail ? "show-mobile-detail" : ""}
        >
          <div className="demo-banner">
            <ShieldCheck size={16} />
            <span>Demo mode — no emergency alerts are sent.</span>
          </div>
          {repository.warning && <Notice error>{repository.warning}</Notice>}
          {error && (
            <div className="error-bar" role="alert">
              <WarningCircle size={22} />
              <span>{error}</span>
              <button onClick={() => setError("")} className="text-button">
                Dismiss
              </button>
            </div>
          )}
          {route === "enrollment" || route === "residents" ? (
            <div
              className={`workspace ${route === "residents" ? "directory" : ""}`}
            >
              <section className="resident-column">
                <div className="heading-row">
                  <h1>
                    {route === "enrollment"
                      ? "Connect residents’ phones"
                      : "Colony residents"}
                  </h1>
                  <p className="lead">
                    {route === "enrollment"
                      ? "Verified residents ready for Kavach activation."
                      : "Manage profiles and support every enrollment."}
                  </p>
                </div>
                <div className="summary-row">
                  <p>
                    <strong>{summary.ready}</strong> ready <span>·</span>{" "}
                    <strong>{summary.today}</strong> completed today{" "}
                    <span>·</span> <strong>{summary.needs}</strong> need details
                  </p>
                  <button
                    className="add-resident"
                    onClick={() => setForm(emptyResident(state.community.id))}
                  >
                    <Plus size={19} weight="bold" />
                    Add resident
                  </button>
                </div>
                <div className="list-controls">
                  <label className="search">
                    <MagnifyingGlass size={20} />
                    <span className="sr-only">Search residents</span>
                    <input
                      aria-label="Search residents"
                      placeholder="Search name, house or mobile"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label className="status-filter">
                    <span className="sr-only">Enrollment status</span>
                    <select
                      aria-label="Enrollment status"
                      value={filter}
                      onChange={(e) =>
                        setFilter(e.target.value as EnrollmentStatus | "All")
                      }
                    >
                      <option>All</option>
                      {statuses.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="list-heading">
                  <h2>{filter === "All" ? "All residents" : filter}</h2>
                  <span>
                    {shown.length}{" "}
                    {shown.length === 1 ? "resident" : "residents"}
                  </span>
                </div>
                <div className="resident-list">
                  {shown.map((r) => (
                    <button
                      key={r.id}
                      className={`resident-card ${selected === r.id && route === "enrollment" ? "selected" : ""}`}
                      aria-pressed={selected === r.id && route === "enrollment"}
                      onClick={() =>
                        route === "residents" ? setDetail(r.id) : choose(r)
                      }
                    >
                      <Avatar resident={r} />
                      <div className="resident-name">
                        <h3>{r.name}</h3>
                        <p>House No. {r.house || "Not entered"}</p>
                        <p>
                          {r.age && `Age ${r.age} · `}
                          {r.category}
                        </p>
                      </div>
                      <div className="resident-status">
                        {isVerified(state, r) ? (
                          <Verified />
                        ) : (
                          <span className="pending-status">
                            {r.consent
                              ? "Verification pending"
                              : "Consent needed"}
                          </span>
                        )}
                        <span>{statusOf(state, r)}</span>
                      </div>
                      <CaretRight size={21} />
                    </button>
                  ))}
                </div>
                {!shown.length && (
                  <div className="empty">
                    <UsersThree size={48} />
                    <h3>
                      {query
                        ? "No matching residents"
                        : filter === "Ready to activate"
                          ? "No residents waiting for activation"
                          : "No residents in this view"}
                    </h3>
                    <p>
                      {query
                        ? "Try another name, house number or mobile number."
                        : "Choose another status or add a resident to continue."}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setFilter("All");
                        setQuery("");
                      }}
                    >
                      Show all residents
                    </button>
                  </div>
                )}
                <p className="list-footnote">
                  Fictional resident records · Changes are saved in this browser
                </p>
              </section>
              {route === "enrollment" && (
                <ActivationPanel
                  resident={resident}
                  state={state}
                  now={now}
                  onView={() => resident && setDetail(resident.id)}
                  onNext={next}
                  onBack={() => setMobileDetail(false)}
                  run={run}
                />
              )}
            </div>
          ) : route === "sos" ? (
            <section className="page-placeholder">
              <ShieldCheck size={64} weight="duotone" />
              <span className="eyebrow">COMING IN A LATER PHASE</span>
              <h1>SOS monitoring</h1>
              <p>SOS monitoring will be available in a later phase.</p>
              <p className="muted">
                For now, your office can register residents, verify community
                membership and demonstrate phone activation.
              </p>
              <a href="#enrollment" className="primary">
                Return to enrollment <ArrowRight size={19} />
              </a>
            </section>
          ) : (
            <Settings
              key={state.community.name + state.administrator.name}
              state={state}
              run={run}
              onReset={() => setReset(true)}
            />
          )}
        </main>
      </div>
      {feedback && (
        <div className="toast" role="status">
          <ShieldCheck size={23} weight="fill" />
          {feedback}
        </div>
      )}
      {form && (
        <ResidentForm
          resident={form}
          state={state}
          onClose={() => setForm(null)}
          onSave={(r, verify) =>
            run(() => {
              repository.save(r);
              setForm(null);
              setSelected(r.id);
              if (verify) setDetail(r.id);
            }, "Resident details saved.")
          }
        />
      )}
      {detailResident && (
        <ResidentDetail
          resident={detailResident}
          state={state}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setForm(detailResident);
            setDetail(null);
          }}
          run={run}
        />
      )}
      {reset && (
        <Dialog
          title="Reset fictional demo data?"
          onClose={() => setReset(false)}
        >
          <p>
            This replaces all changes in this browser with the original
            demonstration residents. It does not affect any real community
            records.
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setReset(false)}>
              Keep my changes
            </button>
            <button
              className="primary"
              onClick={() => {
                repository.reset();
                repository.generate("resident-1");
                setSelected("resident-1");
                setReset(false);
                setFeedback("Demo data reset.");
              }}
            >
              Reset demo data
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function Settings({
  state,
  run,
  onReset,
}: {
  state: ReturnType<typeof repository.getSnapshot>;
  run: (fn: () => void, message?: string) => void;
  onReset: () => void;
}) {
  const [name, setName] = useState(state.community.name),
    [address, setAddress] = useState(state.community.address),
    [admin, setAdmin] = useState(state.administrator.name);
  return (
    <section className="settings">
      <h1>Office settings</h1>
      <p className="lead">Simple preferences for this local demo.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => repository.settings(name, address, admin),
            "Office settings saved.",
          );
        }}
      >
        <label className="field">
          <span>Community display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Community address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Administrator display name</span>
          <input
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
            required
          />
        </label>
        <button className="primary">Save settings</button>
      </form>
      <div className="reset-section">
        <h2>Start a fresh demonstration</h2>
        <p>Restore the original fictional residents and pairing states.</p>
        <button className="secondary danger" onClick={onReset}>
          Reset demo data
        </button>
      </div>
    </section>
  );
}
