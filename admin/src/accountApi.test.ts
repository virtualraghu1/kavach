import { describe, expect, it } from "vitest";
import { workspaceSchema } from "./accountApi";

const workspace = {
  account: {
    id: "account-1",
    kind: "staff",
    status: "active",
    username: "meena.rao",
    displayName: "Meena Rao",
  },
  roles: [
    {
      role: "community_staff",
      communityId: "00000000-0000-4000-8000-000000000001",
    },
  ],
  communities: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "hig-bhel-township-hyderabad",
      displayName: "HIG, BHEL Township, Hyderabad",
      officeContactText: "Please visit the community office.",
      timezone: "Asia/Kolkata",
      active: true,
    },
  ],
  residents: [],
  staff: [],
};

describe("account workspace contract", () => {
  it("accepts the trusted role and community response", () => {
    expect(workspaceSchema.parse(workspace).account.username).toBe("meena.rao");
  });

  it("rejects roles and account states outside the allowlist", () => {
    expect(() =>
      workspaceSchema.parse({
        ...workspace,
        roles: [{ role: "superuser", communityId: null }],
      }),
    ).toThrow();
    expect(() =>
      workspaceSchema.parse({
        ...workspace,
        account: { ...workspace.account, status: "disabled" },
      }),
    ).toThrow();
  });
});
