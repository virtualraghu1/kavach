import { describe, expect, it } from "vitest";

describe("Supabase client configuration", () => {
  it("does not include privileged environment-variable names in client source", async () => {
    const source = await import("./supabaseClient?raw");
    expect(source.default).not.toMatch(/service.role|secret.key/i);
  });
});
