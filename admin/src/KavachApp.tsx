import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowClockwise,
  Buildings,
  CheckCircle,
  Eye,
  EyeSlash,
  GearSix,
  House,
  Info,
  LockKey,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SignOut,
  User,
  UserGear,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  AccountApiError,
  accountMutation,
  completeAccountSetup,
  createStaffSetup,
  loadWorkspace,
  regenerateStaffSetup,
  signIn,
  type StaffSetupGrant,
  type Workspace,
  type WorkspaceResident,
} from "./accountApi";
import { Dialog } from "./components";
import { supabase, supabaseConfigured } from "./supabaseClient";
import { DemoApp } from "./App";

type AppRoute =
  | "communities"
  | "administrators"
  | "residents"
  | "enrollment"
  | "profile"
  | "help"
  | "settings";

type SignInView = "sign-in" | "setup" | "recovery";

const previewCommunityId = "00000000-0000-4000-8000-000000000001";

function previewWorkspace(role: "owner" | "staff" | "resident"): Workspace {
  const residents: Workspace["residents"] = [
    {
      id: "resident-lakshmi",
      communityId: previewCommunityId,
      fullName: "Lakshmi Narayanan",
      houseNumber: "B-42",
      block: "HIG Block B",
      category: "senior",
      preferredLanguage: "Tamil",
      profileStatus: "active",
      membershipStatus: "active",
      verified: true,
      consentRecorded: true,
      accountStatus: "active",
      activatedAt: "2026-09-14T08:20:00Z",
      createdAt: "2026-09-10T08:20:00Z",
    },
    {
      id: "resident-ravi",
      communityId: previewCommunityId,
      fullName: "Ravi Kumar",
      houseNumber: "D-07",
      block: "HIG Block D",
      category: "community_member",
      preferredLanguage: "Telugu",
      profileStatus: "active",
      membershipStatus: "active",
      verified: true,
      consentRecorded: true,
      accountStatus: "pending",
      activatedAt: null,
      createdAt: "2026-09-11T08:20:00Z",
    },
    {
      id: "resident-anitha",
      communityId: previewCommunityId,
      fullName: "Anitha Reddy",
      houseNumber: "C-18",
      block: "HIG Block C",
      category: "community_member",
      preferredLanguage: "Telugu",
      profileStatus: "active",
      membershipStatus: "active",
      verified: false,
      consentRecorded: true,
      accountStatus: "not_created",
      activatedAt: null,
      createdAt: "2026-09-12T08:20:00Z",
    },
    {
      id: "resident-janaki",
      communityId: previewCommunityId,
      fullName: "Janaki Subramanian",
      houseNumber: "A-11",
      block: "HIG Block A",
      category: "senior",
      preferredLanguage: "Tamil",
      profileStatus: "active",
      membershipStatus: "active",
      verified: true,
      consentRecorded: true,
      accountStatus: "not_created",
      activatedAt: null,
      createdAt: "2026-09-13T08:20:00Z",
    },
  ];
  const isResident = role === "resident";
  return {
    account: {
      id: `preview-${role}`,
      kind:
        role === "owner" ? "owner" : role === "staff" ? "staff" : "resident",
      status: "active",
      username:
        role === "owner"
          ? "kavach.owner"
          : role === "staff"
            ? "meena.rao"
            : "lakshmi.n",
      displayName:
        role === "owner"
          ? "Kavach Owner"
          : role === "staff"
            ? "Meena Rao"
            : "Lakshmi Narayanan",
    },
    roles: [
      {
        role:
          role === "owner"
            ? "owner"
            : role === "staff"
              ? "community_staff"
              : "resident",
        communityId: role === "owner" ? null : previewCommunityId,
      },
    ],
    communities: [
      {
        id: previewCommunityId,
        slug: "hig-bhel-township-hyderabad",
        displayName: "HIG, BHEL Township, Hyderabad",
        officeContactText:
          "Please visit the HIG community office for account help.",
        timezone: "Asia/Kolkata",
        active: true,
      },
    ],
    residents: isResident ? residents.slice(0, 1) : residents,
    staff:
      role === "owner"
        ? [
            {
              accountId: "staff-meena",
              username: "meena.rao",
              displayName: "Meena Rao",
              status: "active",
              activatedAt: "2026-09-12T06:30:00Z",
              assignments: [{ communityId: previewCommunityId, active: true }],
            },
            {
              accountId: "staff-anitha",
              username: "anitha.reddy",
              displayName: "Anitha Reddy",
              status: "pending",
              activatedAt: null,
              assignments: [{ communityId: previewCommunityId, active: true }],
            },
          ]
        : [],
  };
}

function Brand({ subtitle }: { subtitle: string }) {
  return (
    <div className="brand auth-brand">
      <img className="brand-mark" src="/brand-mark.png" alt="" />
      <div>
        <strong>Kavach</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

function LoginScreen({
  onSignIn,
  onCompleteSetup,
  busy,
  error,
}: {
  onSignIn: (identifier: string, password: string) => Promise<void>;
  onCompleteSetup: (
    username: string,
    code: string,
    password: string,
  ) => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const [view, setView] = useState<SignInView>("sign-in");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="About Kavach">
        <Brand subtitle="Community safety, made simple." />
        <div className="auth-reassurance">
          <ShieldCheck size={42} weight="duotone" />
          <div>
            <h1>One account for your community</h1>
            <p>
              Residents and authorised office staff use the account provided by
              their community office.
            </p>
          </div>
        </div>
        <p className="auth-location">HIG, BHEL Township, Hyderabad</p>
      </section>

      <section className="auth-card" aria-labelledby="auth-title">
        {view === "sign-in" ? (
          <>
            <span className="eyebrow">SECURE ACCOUNT ACCESS</span>
            <h1 id="auth-title">Sign in to continue</h1>
            <p className="auth-copy">
              Use your Kavach username or your verified email address.
            </p>
            {!supabaseConfigured && (
              <div className="notice notice-error" role="alert">
                <WarningCircle size={21} />
                <span>
                  Supabase public configuration is missing from this build.
                </span>
              </div>
            )}
            {error && (
              <div className="notice notice-error" role="alert">
                <WarningCircle size={21} />
                <span>{error}</span>
              </div>
            )}
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onSignIn(identifier, password);
              }}
            >
              <label className="field">
                <span>Username or email</span>
                <input
                  autoCapitalize="none"
                  autoComplete="username"
                  inputMode="email"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label className="field password-field">
                <span>Password</span>
                <span className="password-control">
                  <input
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? <EyeSlash size={22} /> : <Eye size={22} />}
                    <span>{showPassword ? "Hide" : "Show"}</span>
                  </button>
                </span>
              </label>
              <button className="primary auth-submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <div className="auth-links">
              <button className="text-button" onClick={() => setView("setup")}>
                Set up my account
              </button>
              <button
                className="text-button"
                onClick={() => setView("recovery")}
              >
                Forgot password?
              </button>
            </div>
            <p className="auth-footnote">
              Passwords and sign-in sessions are handled by Kavach’s separate
              Supabase project.
            </p>
          </>
        ) : (
          <AccountHelp
            view={view}
            onBack={() => setView("sign-in")}
            onCompleteSetup={onCompleteSetup}
            onSetupFinished={(username) => {
              setIdentifier(username);
              setPassword("");
              setView("sign-in");
            }}
          />
        )}
      </section>
    </main>
  );
}

function AccountHelp({
  view,
  onBack,
  onCompleteSetup,
  onSetupFinished,
}: {
  view: Exclude<SignInView, "sign-in">;
  onBack: () => void;
  onCompleteSetup: (
    username: string,
    code: string,
    password: string,
  ) => Promise<void>;
  onSetupFinished: (username: string) => void;
}) {
  const setup = view === "setup";
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  if (setup && completed) {
    return (
      <div className="account-help setup-complete" role="status">
        <span className="help-icon success-icon">
          <CheckCircle size={36} weight="fill" />
        </span>
        <h1 id="auth-title">Password setup completed</h1>
        <p>
          Your account is ready. Sign in with your username and the password
          you just chose.
        </p>
        <button
          className="primary auth-back"
          onClick={() => onSetupFinished(username.trim().toLowerCase())}
        >
          Continue to sign in
        </button>
      </div>
    );
  }
  return (
    <div className="account-help">
      <span className="help-icon">
        {setup ? <UserGear size={34} /> : <LockKey size={34} />}
      </span>
      <h1 id="auth-title">
        {setup ? "Set up my account" : "Forgot your password?"}
      </h1>
      <p>
        {setup
          ? "Account setup begins with an in-person code created by authorised community-office staff."
          : "For your safety, the community office assists with password recovery after checking your identity in person."}
      </p>
      {setup ? (
        <form
          className="auth-form setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            if (password !== confirmation) {
              setError("The two passwords do not match.");
              return;
            }
            setBusy(true);
            void onCompleteSetup(username, code, password)
              .then(() => setCompleted(true))
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Account setup could not be completed.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {error && (
            <div className="notice notice-error" role="alert">
              <WarningCircle size={21} /> <span>{error}</span>
            </div>
          )}
          <label className="field">
            <span>Username</span>
            <input
              autoCapitalize="none"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>Six-digit setup code</span>
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]{6,7}"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label className="field password-field">
            <span>Choose a password</span>
            <span className="password-control">
              <input
                autoComplete="new-password"
                type={showPassword ? "text" : "password"}
                minLength={6}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeSlash size={22} /> : <Eye size={22} />}
                <span>{showPassword ? "Hide" : "Show"}</span>
              </button>
            </span>
            <small>Use at least 6 characters.</small>
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              type={showPassword ? "text" : "password"}
              minLength={6}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <button className="primary auth-submit" disabled={busy}>
            {busy ? "Saving password…" : "Set my password"}
          </button>
          <p className="muted small">
            The office cannot see the password you choose.
          </p>
        </form>
      ) : (
        <>
          <div className="office-help-box">
            <strong>HIG community office</strong>
            <span>Please visit the office for account help.</span>
            <small>No phone number or opening hours have been configured.</small>
          </div>
          <p className="muted small">
            The office will issue a short-lived recovery code. Kavach will
            never display your existing password.
          </p>
        </>
      )}
      <button className="secondary auth-back" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="auth-loading" role="status">
      <Brand subtitle="Secure community access" />
      <ArrowClockwise className="loading-icon" size={34} />
      <p>{message}</p>
    </main>
  );
}

export function App() {
  const previewRole = import.meta.env.DEV
    ? new URLSearchParams(location.search).get("preview-role")
    : null;
  const legacyPreview =
    import.meta.env.DEV &&
    new URLSearchParams(location.search).get("legacy-demo") === "1";
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(
    previewRole === "owner" ||
      previewRole === "staff" ||
      previewRole === "resident"
      ? previewWorkspace(previewRole)
      : null,
  );
  const [loading, setLoading] = useState(!previewRole && !legacyPreview);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  const refreshWorkspace = useCallback(async (activeSession: Session) => {
    const next = await loadWorkspace(activeSession.access_token);
    setWorkspace(next);
    return next;
  }, []);

  useEffect(() => {
    if (previewRole || legacyPreview || !supabase) {
      setLoading(false);
      return;
    }
    const client = supabase;
    let current = true;
    void client.auth.getSession().then(async ({ data }) => {
      if (!current) return;
      setSession(data.session);
      if (data.session) {
        try {
          await refreshWorkspace(data.session);
        } catch {
          await client.auth.signOut({ scope: "local" });
          if (current)
            setError("Your previous session has ended. Please sign in again.");
        }
      }
      if (current) setLoading(false);
    });
    const { data: subscription } = client.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!current) return;
        setSession(nextSession);
        if (event === "SIGNED_OUT") setWorkspace(null);
      },
    );
    return () => {
      current = false;
      subscription.subscription.unsubscribe();
    };
  }, [legacyPreview, previewRole, refreshWorkspace]);

  if (legacyPreview) return <DemoApp />;
  if (loading)
    return <LoadingScreen message="Restoring your secure session…" />;

  const handleSignIn = async (identifier: string, password: string) => {
    setSigningIn(true);
    setError("");
    try {
      const nextSession = await signIn(identifier, password);
      setSession(nextSession);
      await refreshWorkspace(nextSession);
    } catch (reason) {
      setWorkspace(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to sign in. Check your details and try again.",
      );
    } finally {
      setSigningIn(false);
    }
  };

  if (!workspace || (!session && !previewRole)) {
    return (
      <LoginScreen
        onSignIn={handleSignIn}
        onCompleteSetup={async (username, code, password) => {
          await completeAccountSetup(username, code, password);
        }}
        busy={signingIn}
        error={error}
      />
    );
  }

  const preview = Boolean(previewRole);
  return (
    <AuthenticatedShell
      workspace={workspace}
      preview={preview}
      onRefresh={async () => {
        if (!session || preview) return;
        await refreshWorkspace(session);
      }}
      onMutate={async (action, values) => {
        if (!session || preview) {
          throw new AccountApiError(
            "Changes are disabled in the development preview.",
            400,
          );
        }
        await accountMutation(action, values, session.access_token);
        await refreshWorkspace(session);
      }}
      onCreateStaff={async (values) => {
        if (!session || preview) {
          throw new AccountApiError(
            "Changes are disabled in the development preview.",
            400,
          );
        }
        const setup = await createStaffSetup(values, session.access_token);
        await refreshWorkspace(session);
        return setup;
      }}
      onRegenerateStaff={async (accountId) => {
        if (!session || preview) {
          throw new AccountApiError(
            "Changes are disabled in the development preview.",
            400,
          );
        }
        return regenerateStaffSetup(accountId, session.access_token);
      }}
      onSignOut={async () => {
        if (preview) {
          location.href = location.pathname;
          return;
        }
        await supabase?.auth.signOut({ scope: "local" });
        setWorkspace(null);
        setSession(null);
      }}
    />
  );
}

function AuthenticatedShell({
  workspace,
  preview,
  onRefresh,
  onMutate,
  onCreateStaff,
  onRegenerateStaff,
  onSignOut,
}: {
  workspace: Workspace;
  preview: boolean;
  onRefresh: () => Promise<void>;
  onMutate: (
    action:
      "create_community" | "set_community_status" | "set_staff_account_status",
    values: Record<string, unknown>,
  ) => Promise<void>;
  onCreateStaff: (values: {
    displayName: string;
    username: string;
    communityId: string;
  }) => Promise<StaffSetupGrant>;
  onRegenerateStaff: (accountId: string) => Promise<StaffSetupGrant>;
  onSignOut: () => Promise<void>;
}) {
  const owner = workspace.roles.some((role) => role.role === "owner");
  const resident = workspace.account.kind === "resident";
  const defaultRoute: AppRoute = owner
    ? "communities"
    : resident
      ? "profile"
      : "residents";
  const [route, setRoute] = useState<AppRoute>(defaultRoute);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const community = workspace.communities[0];
  const roleLabel = owner
    ? "Super Admin"
    : resident
      ? "Resident"
      : "Society Admin";
  const nav = owner
    ? [
        {
          route: "communities" as const,
          label: "Communities",
          icon: Buildings,
        },
        {
          route: "administrators" as const,
          label: "Administrators",
          icon: UserGear,
        },
        { route: "residents" as const, label: "Residents", icon: UsersThree },
        { route: "settings" as const, label: "Settings", icon: GearSix },
      ]
    : resident
      ? [
          { route: "profile" as const, label: "My profile", icon: User },
          { route: "help" as const, label: "Office help", icon: Info },
          { route: "settings" as const, label: "Account", icon: GearSix },
        ]
      : [
          { route: "residents" as const, label: "Residents", icon: House },
          {
            route: "enrollment" as const,
            label: "Enrollment",
            icon: UsersThree,
          },
          { route: "settings" as const, label: "Settings", icon: GearSix },
        ];

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setNotice(success);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Kavach could not complete this request.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <a className="skip-link" href="#account-main">
        Skip to content
      </a>
      <header className="app-header secure-header">
        <Brand subtitle={community?.displayName ?? "Kavach communities"} />
        <div className="header-right">
          <time>
            {new Intl.DateTimeFormat("en-IN", {
              dateStyle: "full",
              timeZone: "Asia/Kolkata",
            }).format(new Date())}
          </time>
          <div className="admin-profile">
            <ProfileAvatar name={workspace.account.displayName} />
            <div>
              <strong>{workspace.account.displayName}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
        </div>
      </header>
      <div className="app-layout secure-layout">
        <aside className="sidebar secure-sidebar">
          <nav aria-label="Account navigation">
            {nav.map((item) => (
              <button
                key={item.route}
                type="button"
                aria-current={route === item.route ? "page" : undefined}
                onClick={() => {
                  setRoute(item.route);
                  setError("");
                  setNotice("");
                }}
              >
                <item.icon size={27} weight="fill" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <p>Signed in as</p>
            <strong>@{workspace.account.username || "account"}</strong>
            <div className="short-rule" />
            <button
              className="sidebar-signout"
              onClick={() => void onSignOut()}
            >
              <SignOut size={19} /> Sign out
            </button>
          </div>
        </aside>
        <main id="account-main" tabIndex={-1} className="secure-main">
          {preview && (
            <div className="preview-banner">
              <Info size={17} /> Development preview — actions do not change
              data.
            </div>
          )}
          {error && (
            <div className="error-bar" role="alert">
              <WarningCircle size={22} />
              <span>{error}</span>
              <button className="text-button" onClick={() => setError("")}>
                Dismiss
              </button>
            </div>
          )}
          {notice && (
            <div className="success-bar" role="status">
              <CheckCircle size={22} weight="fill" /> {notice}
            </div>
          )}
          {route === "communities" && owner ? (
            <CommunitiesPage
              workspace={workspace}
              busy={busy}
              run={run}
              onMutate={onMutate}
            />
          ) : route === "administrators" && owner ? (
            <AdministratorsPage
              workspace={workspace}
              busy={busy}
              run={run}
              onMutate={onMutate}
              onCreateStaff={onCreateStaff}
              onRegenerateStaff={onRegenerateStaff}
            />
          ) : route === "residents" || route === "enrollment" ? (
            <ResidentsPage
              workspace={workspace}
              enrollmentOnly={route === "enrollment"}
            />
          ) : route === "profile" && resident ? (
            <ResidentProfile workspace={workspace} />
          ) : route === "help" && resident ? (
            <OfficeHelp workspace={workspace} />
          ) : (
            <AccountSettings
              workspace={workspace}
              busy={busy}
              onRefresh={() => run(onRefresh, "Account information refreshed.")}
              onSignOut={onSignOut}
            />
          )}
        </main>
      </div>
    </>
  );
}

function ProfileAvatar({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) {
  const image =
    name === "Meena Rao"
      ? "/avatars/meena.png"
      : name === "Lakshmi Narayanan"
        ? "/avatars/lakshmi.png"
        : name === "Anitha Reddy"
          ? "/avatars/anitha.png"
          : name === "Ravi Kumar"
            ? "/avatars/ravi.png"
            : name === "Janaki Subramanian"
              ? "/avatars/janaki.png"
              : null;
  return (
    <span
      className={`avatar ${large ? "avatar-large" : ""}`}
      aria-hidden="true"
    >
      {image ? (
        <img src={image} alt="" />
      ) : (
        name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}

function CommunitiesPage({
  workspace,
  busy,
  run,
  onMutate,
}: {
  workspace: Workspace;
  busy: boolean;
  run: (work: () => Promise<void>, success: string) => Promise<void>;
  onMutate: (
    action: "create_community" | "set_community_status",
    values: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [officeHelp, setOfficeHelp] = useState("");
  return (
    <section className="management-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">KAVACH OWNER WORKSPACE</span>
          <h1>Communities and administrators</h1>
          <p className="lead">
            Manage each society as an isolated Kavach community.
          </p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          <Plus size={20} weight="bold" /> Add community
        </button>
      </div>
      <div className="metric-strip" aria-label="Community totals">
        <div>
          <strong>{workspace.communities.length}</strong>
          <span>communities</span>
        </div>
        <div>
          <strong>{workspace.staff.length}</strong>
          <span>society admins</span>
        </div>
        <div>
          <strong>{workspace.residents.length}</strong>
          <span>resident profiles</span>
        </div>
      </div>
      <div className="community-grid">
        {workspace.communities.map((community) => {
          const residents = workspace.residents.filter(
            (resident) => resident.communityId === community.id,
          ).length;
          const administrators = workspace.staff.filter((staff) =>
            staff.assignments.some(
              (assignment) => assignment.communityId === community.id,
            ),
          ).length;
          return (
            <article className="community-card" key={community.id}>
              <div className="community-icon">
                <Buildings size={27} weight="fill" />
              </div>
              <div className="community-card-body">
                <div className="card-heading-row">
                  <div>
                    <h2>{community.displayName}</h2>
                    <p>
                      {community.officeContactText ||
                        "Office contact details not configured"}
                    </p>
                  </div>
                  <StatusPill tone={community.active ? "green" : "gray"}>
                    {community.active ? "Active" : "Inactive"}
                  </StatusPill>
                </div>
                <div className="community-counts">
                  <span>
                    <UsersThree size={19} /> {residents} residents
                  </span>
                  <span>
                    <UserGear size={19} /> {administrators} admins
                  </span>
                </div>
                <button
                  className={
                    community.active ? "secondary danger" : "secondary"
                  }
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        onMutate("set_community_status", {
                          communityId: community.id,
                          active: !community.active,
                        }),
                      community.active
                        ? "Community disabled."
                        : "Community enabled.",
                    )
                  }
                >
                  {community.active ? "Disable community" : "Enable community"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {adding && (
        <Dialog title="Add a Kavach community" onClose={() => setAdding(false)}>
          <p className="dialog-intro">
            Each community has separate staff assignments and resident access.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  onMutate("create_community", {
                    displayName: name,
                    slug,
                    officeContactText: officeHelp || undefined,
                  }),
                "Community created.",
              ).then(() => setAdding(false));
            }}
          >
            <div className="form-grid">
              <label className="field">
                <span>Community name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>URL name</span>
                <input
                  value={slug}
                  onChange={(event) =>
                    setSlug(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, "-"),
                    )
                  }
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>Office help instructions</span>
              <input
                value={officeHelp}
                onChange={(event) => setOfficeHelp(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                Create community
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

function AdministratorsPage({
  workspace,
  busy,
  run,
  onMutate,
  onCreateStaff,
  onRegenerateStaff,
}: {
  workspace: Workspace;
  busy: boolean;
  run: (work: () => Promise<void>, success: string) => Promise<void>;
  onMutate: (
    action: "set_staff_account_status",
    values: Record<string, unknown>,
  ) => Promise<void>;
  onCreateStaff: (values: {
    displayName: string;
    username: string;
    communityId: string;
  }) => Promise<StaffSetupGrant>;
  onRegenerateStaff: (accountId: string) => Promise<StaffSetupGrant>;
}) {
  const [adding, setAdding] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [communityId, setCommunityId] = useState(
    workspace.communities.find((community) => community.active)?.id ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [setupGrant, setSetupGrant] = useState<StaffSetupGrant | null>(null);
  const communityName = (communityId: string) =>
    workspace.communities.find((community) => community.id === communityId)
      ?.displayName ?? "Unknown community";
  const closeDialog = () => {
    setAdding(false);
    setSetupGrant(null);
    setDialogError("");
  };
  const showGrant = async (work: () => Promise<StaffSetupGrant>) => {
    setSubmitting(true);
    setDialogError("");
    try {
      setSetupGrant(await work());
      setAdding(true);
    } catch (reason) {
      setDialogError(
        reason instanceof Error
          ? reason.message
          : "The setup code could not be generated.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <section className="management-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">ROLE MANAGEMENT</span>
          <h1>Society administrators</h1>
          <p className="lead">
            Control office access without sharing passwords.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setDisplayName("");
            setUsername("");
            setSetupGrant(null);
            setDialogError("");
            setAdding(true);
          }}
        >
          <Plus size={20} weight="bold" /> Add society administrator
        </button>
      </div>
      <div className="admin-list">
        {workspace.staff.length ? (
          workspace.staff.map((staff) => (
            <article className="admin-row" key={staff.accountId}>
              <ProfileAvatar name={staff.displayName} />
              <div className="admin-row-person">
                <h2>{staff.displayName}</h2>
                <p>@{staff.username}</p>
              </div>
              <div className="admin-assignments">
                <strong>Society Admin</strong>
                {staff.assignments.map((assignment) => (
                  <span key={assignment.communityId}>
                    {communityName(assignment.communityId)}
                  </span>
                ))}
              </div>
              <StatusPill
                tone={
                  staff.status === "active"
                    ? "green"
                    : staff.status === "pending"
                      ? "amber"
                      : "gray"
                }
              >
                {staff.status === "active"
                  ? "Active"
                  : staff.status === "pending"
                    ? "Setup pending"
                    : "Disabled"}
              </StatusPill>
              <button
                className={
                  staff.status === "disabled"
                    ? "secondary"
                    : staff.status === "pending"
                      ? "secondary"
                      : "secondary danger"
                }
                disabled={busy || submitting}
                onClick={() =>
                  staff.status === "pending"
                    ? void showGrant(() => onRegenerateStaff(staff.accountId))
                    : void run(
                        () =>
                          onMutate("set_staff_account_status", {
                            accountId: staff.accountId,
                            status:
                              staff.status === "disabled"
                                ? "active"
                                : "disabled",
                          }),
                        staff.status === "disabled"
                          ? "Administrator access enabled."
                          : "Administrator access disabled.",
                      )
                }
              >
                {staff.status === "pending"
                  ? "Generate new code"
                  : staff.status === "disabled"
                  ? "Enable access"
                  : "Disable access"}
              </button>
            </article>
          ))
        ) : (
          <div className="empty management-empty">
            <UserGear size={48} />
            <h2>No society administrators yet</h2>
            <p>Create staff accounts through the secure setup flow.</p>
          </div>
        )}
      </div>
      <div className="permission-note">
        <LockKey size={23} />
        <div>
          <strong>Permission boundary</strong>
          <p>
            Society administrators can access only their assigned active
            communities. They cannot grant roles or recover owner accounts.
          </p>
        </div>
      </div>
      {dialogError && !adding && (
        <div className="error-bar" role="alert">
          <WarningCircle size={22} /> {dialogError}
        </div>
      )}
      {adding && (
        <Dialog
          title={setupGrant ? "Administrator setup code" : "Add society administrator"}
          onClose={closeDialog}
        >
          {setupGrant ? (
            <div className="staff-setup-result">
              <p className="dialog-intro">
                Ask <strong>@{setupGrant.username}</strong> to open Kavach and
                choose <strong>Set up my account</strong>.
              </p>
              <div className="setup-code-panel" aria-label="Six-digit setup code">
                <span>Setup code</span>
                <strong>{setupGrant.code.slice(0, 3)} {setupGrant.code.slice(3)}</strong>
                <small>
                  Expires at {new Intl.DateTimeFormat("en-IN", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  }).format(new Date(setupGrant.expiresAt))} IST
                </small>
              </div>
              <div className="notice">
                <WarningCircle size={21} />
                <span>
                  Show this code in person. It works once and must not be sent
                  by message. Kavach will never show the administrator’s
                  password.
                </span>
              </div>
              <div className="dialog-actions">
                <button className="primary" onClick={closeDialog}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              className="staff-setup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void showGrant(() =>
                  onCreateStaff({ displayName, username, communityId }),
                );
              }}
            >
              <p className="dialog-intro">
                The administrator will choose their own password using a
                ten-minute, single-use code.
              </p>
              {dialogError && (
                <div className="notice notice-error" role="alert">
                  <WarningCircle size={21} /> <span>{dialogError}</span>
                </div>
              )}
              <label className="field">
                <span>Full name</span>
                <input
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  minLength={2}
                  maxLength={160}
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span>Username</span>
                <input
                  autoCapitalize="none"
                  autoComplete="off"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  pattern="[a-z](?:[a-z0-9._]|-){3,31}"
                  required
                  disabled={submitting}
                />
                <small>4–32 characters. Start with a letter.</small>
              </label>
              <label className="field">
                <span>Community</span>
                <select
                  value={communityId}
                  onChange={(event) => setCommunityId(event.target.value)}
                  required
                  disabled={submitting}
                >
                  {workspace.communities
                    .filter((community) => community.active)
                    .map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <div className="notice">
                <LockKey size={21} />
                <span>
                  This grants Society Admin access only to the selected
                  community. It does not grant Super Admin access.
                </span>
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={closeDialog}>
                  Cancel
                </button>
                <button className="primary" disabled={submitting || !communityId}>
                  {submitting ? "Preparing account…" : "Create setup code"}
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </section>
  );
}

function residentStatus(resident: WorkspaceResident) {
  if (
    resident.membershipStatus === "inactive" ||
    resident.profileStatus === "inactive"
  ) {
    return { label: "Membership inactive", tone: "gray" as const };
  }
  if (!resident.consentRecorded)
    return { label: "Consent needed", tone: "amber" as const };
  if (!resident.verified)
    return { label: "Verification pending", tone: "amber" as const };
  if (resident.accountStatus === "active")
    return { label: "Account activated", tone: "green" as const };
  if (resident.accountStatus === "pending")
    return { label: "Account setup pending", tone: "blue" as const };
  if (resident.membershipStatus === "active")
    return { label: "Ready for account setup", tone: "green" as const };
  return { label: "Details incomplete", tone: "gray" as const };
}

function ResidentsPage({
  workspace,
  enrollmentOnly,
}: {
  workspace: Workspace;
  enrollmentOnly: boolean;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workspace.residents.filter((resident) => {
      const status = residentStatus(resident).label;
      const matches =
        `${resident.fullName} ${resident.houseNumber} ${resident.block ?? ""}`
          .toLowerCase()
          .includes(normalized);
      return matches && (!enrollmentOnly || status !== "Account activated");
    });
  }, [enrollmentOnly, query, workspace.residents]);
  return (
    <section className="management-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">
            {enrollmentOnly ? "ACCOUNT ENROLLMENT" : "COMMUNITY MEMBERS"}
          </span>
          <h1>
            {enrollmentOnly ? "Residents needing account help" : "Residents"}
          </h1>
          <p className="lead">
            {enrollmentOnly
              ? "Authoritative status from membership, consent, verification and account records."
              : "Resident access is limited to the communities assigned to this account."}
          </p>
        </div>
      </div>
      <label className="search management-search">
        <MagnifyingGlass size={21} />
        <span className="sr-only">Search residents</span>
        <input
          aria-label="Search residents"
          placeholder="Search name, house or block"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="resident-management-list">
        {shown.map((resident) => {
          const status = residentStatus(resident);
          return (
            <article className="resident-management-row" key={resident.id}>
              <ProfileAvatar name={resident.fullName} />
              <div className="resident-management-name">
                <h2>{resident.fullName}</h2>
                <p>
                  House No. {resident.houseNumber}
                  {resident.block ? ` · ${resident.block}` : ""}
                </p>
              </div>
              <div className="resident-checks">
                <span
                  className={
                    resident.consentRecorded ? "check-ok" : "check-wait"
                  }
                >
                  {resident.consentRecorded ? (
                    <CheckCircle size={19} weight="fill" />
                  ) : (
                    <WarningCircle size={19} />
                  )}
                  Consent
                </span>
                <span className={resident.verified ? "check-ok" : "check-wait"}>
                  {resident.verified ? (
                    <CheckCircle size={19} weight="fill" />
                  ) : (
                    <WarningCircle size={19} />
                  )}
                  Verification
                </span>
              </div>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </article>
          );
        })}
        {!shown.length && (
          <div className="empty management-empty">
            <UsersThree size={48} />
            <h2>No matching residents</h2>
            <p>Try another name, house number or block.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ResidentProfile({ workspace }: { workspace: Workspace }) {
  const resident = workspace.residents[0];
  const community = workspace.communities.find(
    (item) => item.id === resident?.communityId,
  );
  if (!resident) {
    return (
      <div className="empty">
        <WarningCircle size={48} />
        <h1>Your resident profile is not linked</h1>
        <p>Please ask your community office for help.</p>
      </div>
    );
  }
  const status = residentStatus(resident);
  return (
    <section className="resident-profile-page">
      <div className="resident-welcome">
        <ProfileAvatar name={resident.fullName} large />
        <div>
          <span className="eyebrow">MY KAVACH MEMBERSHIP</span>
          <h1>Hello, {resident.fullName.split(" ")[0]}</h1>
          <p>{community?.displayName}</p>
        </div>
      </div>
      <div className="phase-warning">
        <WarningCircle size={28} weight="fill" />
        <div>
          <strong>Emergency alerts are not enabled yet</strong>
          <p>This account phase provides sign-in and profile access only.</p>
        </div>
      </div>
      <div className="profile-card">
        <div className="card-heading-row">
          <h2>Your verified details</h2>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>
        <dl>
          <div>
            <dt>Full name</dt>
            <dd>{resident.fullName}</dd>
          </div>
          <div>
            <dt>House number</dt>
            <dd>{resident.houseNumber}</dd>
          </div>
          <div>
            <dt>Block</dt>
            <dd>{resident.block || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Preferred language</dt>
            <dd>{resident.preferredLanguage || "Not recorded"}</dd>
          </div>
        </dl>
        <p className="profile-help">
          Verified details are read-only. Ask the community office to correct
          anything that is wrong.
        </p>
      </div>
    </section>
  );
}

function OfficeHelp({ workspace }: { workspace: Workspace }) {
  const community = workspace.communities[0];
  return (
    <section className="simple-account-page">
      <span className="help-icon">
        <Info size={35} />
      </span>
      <h1>Community-office help</h1>
      <p className="lead">
        The office can help with account setup, forgotten passwords and profile
        corrections.
      </p>
      <div className="office-help-box large">
        <strong>{community?.displayName ?? "Your community office"}</strong>
        <span>
          {community?.officeContactText ||
            "Please visit your community office for account help."}
        </span>
        {!community?.officeContactText && (
          <small>No contact details have been configured.</small>
        )}
      </div>
      <div className="permission-note">
        <LockKey size={23} />
        <div>
          <strong>Your password stays private</strong>
          <p>
            Office staff can issue a short-lived recovery code, but they cannot
            see your password.
          </p>
        </div>
      </div>
    </section>
  );
}

function AccountSettings({
  workspace,
  busy,
  onRefresh,
  onSignOut,
}: {
  workspace: Workspace;
  busy: boolean;
  onRefresh: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <section className="simple-account-page">
      <span className="eyebrow">SIGNED-IN ACCOUNT</span>
      <h1>Account and security</h1>
      <div className="account-summary-card">
        <ProfileAvatar name={workspace.account.displayName} large />
        <div>
          <h2>{workspace.account.displayName}</h2>
          <p>@{workspace.account.username}</p>
          <StatusPill tone="green">Active session</StatusPill>
        </div>
      </div>
      <div className="settings-actions">
        <button className="secondary" disabled={busy} onClick={onRefresh}>
          <ArrowClockwise size={20} /> Refresh account
        </button>
        <button className="secondary danger" onClick={() => void onSignOut()}>
          <SignOut size={20} /> Sign out on this device
        </button>
      </div>
      <p className="muted small">
        Kavach checks current account, role, community assignment and session
        status on protected requests.
      </p>
    </section>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "amber" | "blue" | "gray";
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}
