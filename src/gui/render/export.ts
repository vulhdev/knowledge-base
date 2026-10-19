import type { Content } from "../../types.js";

export function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "content";
}

export function buildExportBody(content: Content): string {
  const exported = new Date().toISOString().slice(0, 10);
  const frontmatter = [
    "---",
    `title: ${content.title ?? ""}`,
    `type: ${content.type}`,
    `feature: ${content.features[0] ?? ""}`,
    `workspace: ${content.workspace}`,
    `exported: ${exported}`,
    "---",
    "",
  ].join("\n");
  return frontmatter + content.body;
}
