import { describe, expect, it } from "vitest";
import { parseResidentQr, residentQrUrl } from "./residentQr";

const origin = "https://kavach-plum-one.vercel.app";
const token = "ab".repeat(32);
describe("resident QR boundary", () => {
  it("accepts same-site enrollment links and manually entered tokens", () => {
    expect(parseResidentQr(residentQrUrl(token, origin), origin)).toBe(token);
    expect(parseResidentQr(`  ${token.toUpperCase()}  `, origin)).toBe(token);
  });
  it("rejects links from another environment or a lookalike host", () => {
    for (const host of ["https://kavach-sos-pilot.vercel.app", "https://kavach-plum-one.vercel.app.evil.test", "http://kavach-plum-one.vercel.app"])
      expect(parseResidentQr(`${host}/#enroll=${token}`, origin)).toBeNull();
  });
  it("rejects navigation, scripts, extra parameters and malformed tokens", () => {
    for (const value of ["javascript:alert(1)", `${origin}/other#enroll=${token}`, `${origin}/?redirect=bad#enroll=${token}`, `${origin}/#enroll=${token}&admin=true`, token.slice(1), "", "g".repeat(64)])
      expect(parseResidentQr(value, origin)).toBeNull();
  });
});
