import { describe, it, expect } from "vitest";
import { formatLogLine } from "../../src/log/format.js";

describe("formatLogLine", () => {
  it("produces correct format with timestamp, level, source, and fields", () => {
    const line = formatLogLine("INFO", "create_content", { event: "start", workspace: "kb" });
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] INFO  create_content event=start workspace=kb$/);
  });

  it("puts event field first regardless of insertion order", () => {
    const line = formatLogLine("INFO", "test", { workspace: "kb", event: "done", ms: "42" });
    const fieldsSection = line.split("] INFO  test ")[1];
    expect(fieldsSection).toBe("event=done workspace=kb ms=42");
  });

  it("pads INFO to 5 chars giving 2 spaces before source", () => {
    const line = formatLogLine("INFO", "src", { event: "x" });
    expect(line).toContain("] INFO  src ");
  });

  it("pads WARN to 5 chars giving 2 spaces before source", () => {
    const line = formatLogLine("WARN", "src", { event: "x" });
    expect(line).toContain("] WARN  src ");
  });

  it("ERROR is already 5 chars giving 1 space before source", () => {
    const line = formatLogLine("ERROR", "src", { event: "x" });
    expect(line).toContain("] ERROR src ");
  });

  it("handles no event field — fields appear in insertion order", () => {
    const line = formatLogLine("INFO", "src", { count: "5", ok: "true" });
    expect(line).toContain("count=5 ok=true");
  });

  it("handles empty fields object", () => {
    const line = formatLogLine("INFO", "src", {});
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] INFO  src$/);
  });

  it("timestamp is UTC ISO format without fractional seconds", () => {
    const line = formatLogLine("INFO", "src", { event: "x" });
    const ts = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)?.[1];
    expect(ts).toBeTruthy();
    expect(ts!.length).toBe(19);
  });
});
