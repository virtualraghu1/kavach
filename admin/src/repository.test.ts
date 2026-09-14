import { describe, it, expect } from "vitest";
import { MockRepository, STORAGE_KEY } from "./repository";
import {
  counts,
  currentPairing,
  duplicateOf,
  emptyResident,
  normalizePhone,
  statusOf,
} from "./domain";

function setup() {
  let now = new Date("2026-09-14T04:00:00Z").getTime();
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const repo = new MockRepository(storage, () => now);
  return {
    repo,
    storage,
    data,
    advance: (ms: number) => {
      now += ms;
    },
    time: () => now,
  };
}
describe("Enrollment and pairing rules", () => {
  it("derives the initial counts from all residents", () => {
    const { repo, time } = setup();
    expect(repo.getSnapshot().residents).toHaveLength(15);
    expect(counts(repo.getSnapshot(), time())).toEqual({
      ready: 8,
      today: 3,
      needs: 2,
    });
  });
  it("saves an incomplete draft, then requires explicit verification", () => {
    const { repo } = setup();
    const r = { ...emptyResident("bhel"), name: "Demo Resident" };
    repo.save(r);
    expect(statusOf(repo.getSnapshot(), r)).toBe("Needs details");
    expect(() => repo.verify(r.id, [true, true, true])).toThrow();
    const full = { ...r, house: "B-42", phone: "0000000999", consent: true };
    repo.save(full);
    const saved = repo.getSnapshot().residents.at(-1)!;
    expect(saved.phone).toBe("+910000000999");
    expect(statusOf(repo.getSnapshot(), saved)).toBe("Verification pending");
    expect(() => repo.verify(r.id, [true, false, true])).toThrow();
    repo.verify(r.id, [true, true, true]);
    expect(statusOf(repo.getSnapshot(), saved)).toBe("Ready to activate");
  });
  it("allows shared houses and shared phone numbers", () => {
    const { repo } = setup();
    const a = repo.getSnapshot().residents[0];
    repo.save({ ...a, id: "another", name: "Demo Family Member" });
    expect(duplicateOf(repo.getSnapshot(), { ...a, id: "third" })).toBeTruthy();
    expect(
      repo.getSnapshot().residents.filter((r) => r.phone === a.phone),
    ).toHaveLength(2);
  });
  it("keeps a verified resident with no smartphone waiting for assistance", () => {
    const { repo } = setup();
    const r = repo.getSnapshot().residents[14];
    expect(statusOf(repo.getSnapshot(), r)).toBe("Waiting for phone");
    expect(() => repo.generate(r.id)).toThrow();
  });
  it("gives residents separate sessions and preserves expiry on revisiting and refresh", () => {
    const { repo, advance, storage, time } = setup();
    repo.generate("resident-1");
    const a = currentPairing(repo.getSnapshot(), "resident-1")!;
    advance(40000);
    repo.generate("resident-2");
    repo.generate("resident-1");
    expect(currentPairing(repo.getSnapshot(), "resident-1")).toEqual(a);
    expect(currentPairing(repo.getSnapshot(), "resident-2")!.id).not.toBe(a.id);
    const restored = new MockRepository(storage, time);
    expect(currentPairing(restored.getSnapshot(), "resident-1")).toEqual(a);
  });
  it("requires acknowledgement and completes exactly once", () => {
    const { repo, time } = setup();
    repo.generate("resident-1");
    const p = currentPairing(repo.getSnapshot(), "resident-1")!;
    expect(() => repo.complete("resident-1", p.id)).toThrow();
    repo.acknowledge("resident-1", p.id);
    repo.complete("resident-1", p.id);
    expect(counts(repo.getSnapshot(), time())).toEqual({
      ready: 7,
      today: 4,
      needs: 2,
    });
    expect(() => repo.complete("resident-1", p.id)).toThrow();
    expect(() => repo.acknowledge("resident-1", p.id)).toThrow();
    expect(() => repo.generate("resident-1")).toThrow();
    expect(currentPairing(repo.getSnapshot(), "resident-1")!.code).toBe("");
  });
  it("rejects expired sessions even after acknowledged and regenerates with a new session", () => {
    const { repo, advance } = setup();
    repo.generate("resident-1");
    const p = currentPairing(repo.getSnapshot(), "resident-1")!;
    repo.acknowledge("resident-1", p.id);
    advance(600001);
    expect(() => repo.complete("resident-1", p.id)).toThrow();
    expect(() => repo.acknowledge("resident-1", p.id)).toThrow();
    repo.generate("resident-1", true);
    const q = currentPairing(repo.getSnapshot(), "resident-1")!;
    expect(q.id).not.toBe(p.id);
    expect(q.state).toBe("pending");
    expect(() => repo.complete("resident-1", p.id)).toThrow();
  });
  it("invalidates an old code immediately on regeneration", () => {
    const { repo } = setup();
    repo.generate("resident-1");
    const p = currentPairing(repo.getSnapshot(), "resident-1")!;
    repo.generate("resident-1", true);
    expect(() => repo.acknowledge("resident-1", p.id)).toThrow();
  });
  it.each(["phone", "house", "name", "consent", "phoneAccess"] as const)(
    "invalidates verification and pairing when %s changes",
    (field) => {
      const { repo } = setup();
      repo.generate("resident-1");
      const p = currentPairing(repo.getSnapshot(), "resident-1")!;
      const r = repo.getSnapshot().residents[0];
      const value =
        field === "consent"
          ? false
          : field === "phoneAccess"
            ? "Shared or caregiver phone"
            : field === "phone"
              ? "+910000000098"
              : "Changed";
      repo.save({ ...r, [field]: value });
      expect(() => repo.acknowledge(r.id, p.id)).toThrow();
      expect(
        statusOf(repo.getSnapshot(), repo.getSnapshot().residents[0]),
      ).not.toBe("Ready to activate");
    },
  );
  it("prevents unverified and inactive activation", () => {
    const { repo } = setup();
    expect(() => repo.generate("resident-14")).toThrow();
    repo.generate("resident-1");
    const p = currentPairing(repo.getSnapshot(), "resident-1")!;
    repo.deactivate("resident-1");
    expect(() => repo.complete("resident-1", p.id)).toThrow();
    expect(() => repo.generate("resident-1")).toThrow();
    expect(statusOf(repo.getSnapshot(), repo.getSnapshot().residents[0])).toBe(
      "Inactive",
    );
  });
  it("withdraws verification and revokes an acknowledged pairing", () => {
    const { repo } = setup();
    repo.generate("resident-1");
    const p = currentPairing(repo.getSnapshot(), "resident-1")!;
    repo.acknowledge("resident-1", p.id);
    repo.invalidateVerification("resident-1");
    expect(() => repo.complete("resident-1", p.id)).toThrow();
  });
  it("never logs pairing codes", () => {
    const { repo } = setup();
    repo.generate("resident-1");
    const code = currentPairing(repo.getSnapshot(), "resident-1")!.code;
    expect(JSON.stringify(repo.getSnapshot().activities)).not.toContain(code);
  });
  it("recovers malformed storage and continues if writes fail", () => {
    const { storage, data } = setup();
    data.set(STORAGE_KEY, "{broken");
    const repo = new MockRepository(storage);
    expect(repo.warning).toContain("could not be read");
    expect(repo.getSnapshot().residents).toHaveLength(15);
    const blocked = new MockRepository({
      getItem: () => null,
      setItem: () => {
        throw Error("quota");
      },
    });
    blocked.generate("resident-1");
    expect(blocked.warning).toContain("unavailable");
    expect(currentPairing(blocked.getSnapshot(), "resident-1")).toBeDefined();
  });
  it("resets fictional data and dates completion counts in India", () => {
    const { repo, time, advance } = setup();
    repo.deactivate("resident-1");
    repo.reset();
    expect(counts(repo.getSnapshot(), time()).ready).toBe(8);
    advance(86400000);
    expect(counts(repo.getSnapshot(), time()).today).toBe(0);
  });
  it("normalizes Indian phone formatting", () => {
    expect(normalizePhone("00000 00123")).toBe("+910000000123");
    expect(normalizePhone("+91 00000-00123")).toBe("+910000000123");
  });
});
