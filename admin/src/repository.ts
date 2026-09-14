import {
  canPair,
  currentPairing,
  emptyResident,
  normalizePhone,
  requiredErrors,
  stateSchema,
  type DemoState,
  type Resident,
} from "./domain";

export const STORAGE_KEY = "kavach:admin-demo:v1";
const id = () => crypto.randomUUID();
export function seed(now = Date.now()): DemoState {
  const names = [
    "Lakshmi Narayanan",
    "Ravi Kumar",
    "Anitha Reddy",
    "Janaki Subramanian",
    "Venkatesh Rao",
    "Savitri Devi",
    "Karthik Raman",
    "Padma Srinivasan",
    "Suresh Narayanan",
    "Geetha Krishna",
    "Mohan Reddy",
    "Radha Iyer",
    "Srinivas Rao",
    "Revathi Kumar",
    "Balakrishnan Nair",
  ];
  const houses = [
    "B-42",
    "D-07",
    "C-18",
    "A-11",
    "B-21",
    "C-09",
    "A-16",
    "D-12",
    "B-42",
    "C-22",
    "D-18",
    "A-03",
    "B-06",
    "C-11",
    "A-29",
  ];
  const state: DemoState = {
    version: 1,
    community: {
      id: "bhel",
      name: "BHEL Colony Office",
      address: "BHEL Township, Hyderabad",
    },
    administrator: { id: "meena", name: "Meena Rao", role: "Colony Office" },
    residents: [],
    verifications: [],
    pairings: [],
    activities: [],
  };
  names.forEach((name, i) => {
    const r = {
      ...emptyResident("bhel", now),
      id: `resident-${i + 1}`,
      name,
      house: houses[i],
      phone: `+91000000${String(i + 1).padStart(4, "0")}`,
      age: i === 0 ? "78" : i === 3 ? "72" : "",
      category: (i === 1 || i === 2 || i === 6
        ? "Community member"
        : "Senior") as Resident["category"],
      consent: true,
      avatar:
        i < 4
          ? `/avatars/${["lakshmi", "ravi", "anitha", "janaki"][i]}.png`
          : undefined,
    };
    if (i === 11 || i === 12) {
      r.phone = "";
      r.consent = false;
    }
    if (i === 14) r.phoneAccess = "No smartphone yet";
    state.residents.push(r);
    state.activities.push({
      id: id(),
      communityId: "bhel",
      residentId: r.id,
      text: "Demo profile created",
      at: now - 86400000,
      administrator: "Meena Rao",
    });
    if (i !== 11 && i !== 12 && i !== 13)
      state.verifications.push({
        id: id(),
        communityId: "bhel",
        residentId: r.id,
        administrator: "Meena Rao",
        at: now - 3600000,
        method: "In person",
        valid: true,
      });
    if (i >= 8 && i <= 10)
      state.pairings.push({
        id: id(),
        communityId: "bhel",
        residentId: r.id,
        code: "",
        createdAt: now - 60000,
        expiresAt: now,
        state: "completed",
        completedAt: now,
      });
  });
  return state;
}
export interface ResidentRepository {
  getSnapshot: () => DemoState;
  subscribe: (listener: () => void) => () => void;
  save: (resident: Resident) => void;
  verify: (residentId: string, checks: boolean[]) => void;
  generate: (residentId: string, regenerate?: boolean) => void;
  acknowledge: (residentId: string, sessionId: string) => void;
  complete: (residentId: string, sessionId: string) => void;
}
export class MockRepository implements ResidentRepository {
  private state: DemoState;
  private listeners = new Set<() => void>();
  warning = "";
  constructor(
    private storage?: Pick<Storage, "getItem" | "setItem">,
    private clock: () => number = Date.now,
  ) {
    this.state = seed(clock());
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) this.state = stateSchema.parse(JSON.parse(raw));
    } catch {
      this.warning =
        "Saved demo data could not be read. A fresh demo has been loaded.";
    }
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private commit(next: DemoState) {
    this.state = next;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      this.warning =
        "Browser storage is unavailable. Changes last only until this page is closed.";
    }
    this.listeners.forEach((fn) => fn());
  }
  private resident(s: DemoState, residentId: string) {
    const r = s.residents.find(
      (r) => r.id === residentId && r.communityId === s.community.id,
    );
    if (!r) throw Error("Resident not found.");
    return r;
  }
  private event(s: DemoState, residentId: string, text: string) {
    s.activities.push({
      id: id(),
      communityId: s.community.id,
      residentId,
      text,
      at: this.clock(),
      administrator: s.administrator.name,
    });
  }
  private revoke(s: DemoState, residentId: string) {
    s.pairings
      .filter((p) => p.residentId === residentId)
      .forEach((p) => {
        p.state = "revoked";
        p.code = "";
      });
  }
  save = (resident: Resident) => {
    const s = structuredClone(this.state);
    const old = s.residents.find((r) => r.id === resident.id);
    const r = {
      ...resident,
      communityId: s.community.id,
      name: resident.name.trim(),
      house: resident.house.trim(),
      phone: normalizePhone(resident.phone),
      contactPhone: normalizePhone(resident.contactPhone),
    };
    if (!r.name) throw Error("Enter a name to save a draft.");
    if (old) {
      const changed = [
        "name",
        "house",
        "block",
        "phone",
        "consent",
        "phoneAccess",
      ].some((k) => old[k as keyof Resident] !== r[k as keyof Resident]);
      if (changed) {
        this.revoke(s, r.id);
        s.verifications
          .filter((v) => v.residentId === r.id)
          .forEach((v) => (v.valid = false));
      }
      s.residents = s.residents.map((x) => (x.id === r.id ? r : x));
    } else s.residents.push(r);
    this.event(s, r.id, old ? "Resident details updated" : "Profile created");
    this.commit(s);
  };
  verify = (residentId: string, checks: boolean[]) => {
    const s = structuredClone(this.state),
      r = this.resident(s, residentId);
    if (
      !r.active ||
      Object.keys(requiredErrors(r)).length ||
      checks.length !== 3 ||
      !checks.every(Boolean)
    )
      throw Error(
        "Complete the required details, consent and all three checks first.",
      );
    s.verifications
      .filter((v) => v.residentId === r.id)
      .forEach((v) => (v.valid = false));
    s.verifications.push({
      id: id(),
      communityId: s.community.id,
      residentId,
      administrator: s.administrator.name,
      at: this.clock(),
      method: "In person",
      valid: true,
    });
    this.event(s, residentId, "In-person community verification recorded");
    this.commit(s);
  };
  invalidateVerification = (residentId: string) => {
    const s = structuredClone(this.state);
    this.resident(s, residentId);
    s.verifications
      .filter((v) => v.residentId === residentId)
      .forEach((v) => (v.valid = false));
    this.revoke(s, residentId);
    this.event(s, residentId, "Verification withdrawn");
    this.commit(s);
  };
  deactivate = (residentId: string) => {
    const s = structuredClone(this.state);
    this.resident(s, residentId).active = false;
    this.revoke(s, residentId);
    this.event(s, residentId, "Resident deactivated");
    this.commit(s);
  };
  generate = (residentId: string, regenerate = false) => {
    const s = structuredClone(this.state),
      r = this.resident(s, residentId),
      now = this.clock();
    if (!canPair(s, r))
      throw Error("This resident is not eligible for phone activation.");
    const existing = currentPairing(s, residentId);
    if (
      !regenerate &&
      existing &&
      existing.expiresAt > now &&
      ["pending", "acknowledged"].includes(existing.state)
    )
      return;
    this.revoke(s, residentId);
    let code = "";
    do {
      code = String(
        100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000),
      );
    } while (s.pairings.some((p) => p.code === code));
    s.pairings.push({
      id: id(),
      communityId: s.community.id,
      residentId,
      code,
      createdAt: now,
      expiresAt: now + 600000,
      state: "pending",
    });
    this.event(s, residentId, "Demo pairing session generated");
    this.commit(s);
  };
  private session(s: DemoState, residentId: string, sessionId: string) {
    const r = this.resident(s, residentId),
      p = currentPairing(s, residentId);
    if (
      !canPair(s, r) ||
      !p ||
      p.id !== sessionId ||
      p.expiresAt <= this.clock() ||
      !["pending", "acknowledged"].includes(p.state)
    )
      throw Error(
        "This session is expired or no longer usable. Generate a new code.",
      );
    return p;
  }
  acknowledge = (residentId: string, sessionId: string) => {
    const s = structuredClone(this.state);
    this.session(s, residentId, sessionId).state = "acknowledged";
    this.event(s, residentId, "Demo device acknowledgement simulated");
    this.commit(s);
  };
  complete = (residentId: string, sessionId: string) => {
    const s = structuredClone(this.state),
      p = this.session(s, residentId, sessionId);
    if (p.state !== "acknowledged")
      throw Error("Simulate the phone acknowledgement before confirming.");
    p.state = "completed";
    p.completedAt = this.clock();
    p.code = "";
    this.event(s, residentId, "Demo activation completed");
    this.commit(s);
  };
  settings = (name: string, address: string, admin: string) => {
    if (!name.trim() || !address.trim() || !admin.trim())
      throw Error("Complete all settings fields.");
    const s = structuredClone(this.state);
    s.community.name = name.trim();
    s.community.address = address.trim();
    s.administrator.name = admin.trim();
    this.commit(s);
  };
  reset = () => this.commit(seed(this.clock()));
}
let storage: Storage | undefined;
try {
  if (typeof window !== "undefined") storage = window.localStorage;
} catch {
  /* Memory-only mode is surfaced below. */
}
export const repository = new MockRepository(storage);
if (!storage)
  repository.warning =
    "Browser storage is unavailable. This demo will run in memory only.";
