import { z } from "zod";

export const residentSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  name: z.string(),
  house: z.string(),
  block: z.string(),
  phone: z.string(),
  category: z.enum(["Senior", "Community member"]),
  age: z.string(),
  language: z.string(),
  contactName: z.string(),
  relationship: z.string(),
  contactPhone: z.string(),
  phoneAccess: z.enum([
    "Own smartphone",
    "Shared or caregiver phone",
    "No smartphone yet",
  ]),
  consent: z.boolean(),
  active: z.boolean(),
  avatar: z.string().optional(),
  createdAt: z.number(),
});
export const verificationSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  residentId: z.string(),
  administrator: z.string(),
  at: z.number(),
  method: z.literal("In person"),
  valid: z.boolean(),
});
export const pairingSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  residentId: z.string(),
  code: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  state: z.enum(["pending", "acknowledged", "completed", "revoked"]),
  completedAt: z.number().optional(),
});
export const activitySchema = z.object({
  id: z.string(),
  communityId: z.string(),
  residentId: z.string(),
  text: z.string(),
  at: z.number(),
  administrator: z.string(),
});
export const stateSchema = z.object({
  version: z.literal(1),
  community: z.object({
    id: z.string(),
    name: z.string(),
    address: z.string(),
  }),
  administrator: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
  }),
  residents: z.array(residentSchema),
  verifications: z.array(verificationSchema),
  pairings: z.array(pairingSchema),
  activities: z.array(activitySchema),
});
export type Resident = z.infer<typeof residentSchema>;
export type VerificationRecord = z.infer<typeof verificationSchema>;
export type PairingSession = z.infer<typeof pairingSchema>;
export type ActivityEntry = z.infer<typeof activitySchema>;
export type DemoState = z.infer<typeof stateSchema>;
export type Community = DemoState["community"];
export type Administrator = DemoState["administrator"];
export type EnrollmentStatus =
  | "Ready to activate"
  | "Needs details"
  | "Verification pending"
  | "Waiting for phone"
  | "Completed"
  | "Inactive";
export const statuses: EnrollmentStatus[] = [
  "Ready to activate",
  "Needs details",
  "Verification pending",
  "Waiting for phone",
  "Completed",
  "Inactive",
];
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? "+91" + digits : "+" + digits;
}
export function requiredErrors(r: Resident): Record<string, string> {
  const errors: Record<string, string> = {};
  if (r.name.trim().length < 2) errors.name = "Enter the resident’s full name.";
  if (!r.house.trim()) errors.house = "Enter a house or flat number.";
  if (!/^\+91\d{10}$/.test(normalizePhone(r.phone)))
    errors.phone = "Enter a 10-digit Indian mobile number.";
  if (!r.consent) errors.consent = "Record the resident’s consent to continue.";
  if (r.age && (!/^\d+$/.test(r.age) || +r.age < 1 || +r.age > 120))
    errors.age = "Enter an age between 1 and 120, or leave blank.";
  if (r.contactPhone && !/^\+91\d{10}$/.test(normalizePhone(r.contactPhone)))
    errors.contactPhone = "Enter a 10-digit contact number, or leave blank.";
  return errors;
}
export const isVerified = (s: DemoState, r: Resident) =>
  s.verifications.some(
    (v) => v.residentId === r.id && v.communityId === r.communityId && v.valid,
  );
export function statusOf(s: DemoState, r: Resident): EnrollmentStatus {
  if (!r.active) return "Inactive";
  if (Object.keys(requiredErrors(r)).length) return "Needs details";
  if (!isVerified(s, r)) return "Verification pending";
  if (r.phoneAccess === "No smartphone yet") return "Waiting for phone";
  if (s.pairings.some((p) => p.residentId === r.id && p.state === "completed"))
    return "Completed";
  return "Ready to activate";
}
export function currentPairing(s: DemoState, id: string) {
  return s.pairings
    .filter((p) => p.residentId === id && p.state !== "revoked")
    .at(-1);
}
export function canPair(s: DemoState, r: Resident) {
  return statusOf(s, r) === "Ready to activate";
}
export function indiaDay(time: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
export function counts(s: DemoState, now: number) {
  return {
    ready: s.residents.filter((r) => statusOf(s, r) === "Ready to activate")
      .length,
    needs: s.residents.filter((r) => statusOf(s, r) === "Needs details").length,
    today: s.residents.filter(
      (r) =>
        statusOf(s, r) === "Completed" &&
        s.pairings.some(
          (p) =>
            p.residentId === r.id &&
            p.state === "completed" &&
            p.completedAt &&
            indiaDay(p.completedAt) === indiaDay(now),
        ),
    ).length,
  };
}
export function duplicateOf(s: DemoState, r: Resident) {
  return s.residents.find(
    (other) =>
      other.id !== r.id &&
      other.name.trim().toLowerCase() === r.name.trim().toLowerCase() &&
      other.house.trim().toLowerCase() === r.house.trim().toLowerCase(),
  );
}
export function emptyResident(communityId: string, now = Date.now()): Resident {
  return {
    id: crypto.randomUUID(),
    communityId,
    name: "",
    house: "",
    block: "",
    phone: "",
    category: "Senior",
    age: "",
    language: "Telugu",
    contactName: "",
    relationship: "",
    contactPhone: "",
    phoneAccess: "Own smartphone",
    consent: false,
    active: true,
    createdAt: now,
  };
}
