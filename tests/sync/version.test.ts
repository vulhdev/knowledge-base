import { describe, it, expect } from "vitest";
import { HOST_VERSION, parseMajorMinor } from "../../src/sync/version.js";

describe("parseMajorMinor", () => {
  it("extracts major.minor from stable version", () => {
    expect(parseMajorMinor("1.17.3")).toBe("1.17");
  });

  it("handles major.0 version", () => {
    expect(parseMajorMinor("2.0.0")).toBe("2.0");
  });

  it("strips pre-release suffix", () => {
    expect(parseMajorMinor("1.17.1-beta.8")).toBe("1.17");
  });

  it("handles single-digit minor", () => {
    expect(parseMajorMinor("1.0.5")).toBe("1.0");
  });
});

describe("HOST_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof HOST_VERSION).toBe("string");
    expect(HOST_VERSION.length).toBeGreaterThan(0);
  });

  it("has major.minor.patch format", () => {
    expect(HOST_VERSION).toMatch(/^\d+\.\d+/);
  });
});
