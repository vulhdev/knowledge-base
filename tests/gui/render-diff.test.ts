import { describe, it, expect } from "vitest";
import { renderDiff } from "../../src/gui/render.js";
import type { Content, VersionSummary } from "../../src/types.js";

const now = "2026-01-01T00:00:00.000Z";
const base: Omit<Content, "id" | "version_number" | "root_id" | "body"> = {
  workspace: "ws",
  features: ["feat"],
  type: "spec",
  title: "My Doc",
  has_code_refs: false,
  created_at: now,
  updated_at: now,
};

const fromContent: Content = { ...base, id: 1, version_number: 1, root_id: null, body: "line one\nline two\nline three" };
const toContent: Content = { ...base, id: 2, version_number: 2, root_id: 1, body: "line one\nline two changed\nline three\nline four" };

const versions: VersionSummary[] = [
  { id: 1, version_number: 1, is_latest: false, title: "My Doc", created_at: now, updated_at: now },
  { id: 2, version_number: 2, is_latest: true, title: "My Doc", created_at: now, updated_at: now },
];

describe("renderDiff", () => {
  it("renders added lines with diff-line-add class", () => {
    const html = renderDiff(fromContent, toContent, versions);
    expect(html).toContain("diff-line-add");
  });

  it("renders removed lines with diff-line-del class", () => {
    const html = renderDiff(fromContent, toContent, versions);
    expect(html).toContain("diff-line-del");
  });

  it("renders context lines with diff-line-ctx class", () => {
    const html = renderDiff(fromContent, toContent, versions);
    expect(html).toContain("diff-line-ctx");
  });

  it("shows v{N} → v{M} in heading", () => {
    const html = renderDiff(fromContent, toContent, versions);
    expect(html).toContain("v1");
    expect(html).toContain("v2");
    expect(html).toContain("→");
  });

  it("includes version selector form", () => {
    const html = renderDiff(fromContent, toContent, versions);
    expect(html).toContain('<select name="from"');
    expect(html).toContain('<select name="to"');
    expect(html).toContain('type="submit"');
  });

  it("renders line numbers for both sides", () => {
    const html = renderDiff(fromContent, toContent, versions);
    expect(html).toContain('class="ln"');
  });

  it("escapes HTML in body content", () => {
    const xssContent: Content = { ...base, id: 3, version_number: 1, root_id: null, body: "<script>alert(1)</script>" };
    const xssTo: Content = { ...base, id: 4, version_number: 2, root_id: 3, body: "<b>safe</b>" };
    const xssVersions: VersionSummary[] = [
      { id: 3, version_number: 1, is_latest: false, title: null, created_at: now, updated_at: now },
      { id: 4, version_number: 2, is_latest: true, title: null, created_at: now, updated_at: now },
    ];
    const html = renderDiff(xssContent, xssTo, xssVersions);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows no-differences message when bodies are identical", () => {
    const identical: Content = { ...base, id: 5, version_number: 2, root_id: 1, body: fromContent.body };
    const identicalVersions: VersionSummary[] = [
      { id: 1, version_number: 1, is_latest: false, title: null, created_at: now, updated_at: now },
      { id: 5, version_number: 2, is_latest: true, title: null, created_at: now, updated_at: now },
    ];
    const html = renderDiff(fromContent, identical, identicalVersions);
    expect(html).toContain("No differences");
  });
});
