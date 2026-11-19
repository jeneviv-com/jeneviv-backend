import { describe, expect, it } from "vitest";
import { normaliseNgPhone } from "./phone.js";

describe("normaliseNgPhone", () => {
  it("accepts local, international and spaced formats", () => {
    expect(normaliseNgPhone("08012345678")).toBe("08012345678");
    expect(normaliseNgPhone("+234 801 234 5678")).toBe("08012345678");
    expect(normaliseNgPhone("2348012345678")).toBe("08012345678");
    expect(normaliseNgPhone("8012345678")).toBe("08012345678");
  });

  it("returns undefined for anything that is not a Nigerian mobile number", () => {
    expect(normaliseNgPhone(undefined)).toBeUndefined();
    expect(normaliseNgPhone("")).toBeUndefined();
    expect(normaliseNgPhone("12345")).toBeUndefined();
    expect(normaliseNgPhone("TEST001")).toBeUndefined();
  });
});
