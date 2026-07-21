import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { listWorkspaces } from "../db/workspaces.js";
import { listFeatures, listWorkspaceSummaries, listRecentContents } from "./db.js";
import { listContents } from "../tools/list-contents.js";
import { getContent } from "../tools/get-content.js";
import { getLineage } from "../tools/get-lineage.js";
import { searchSemantic } from "../tools/search-semantic.js";
import type { LineageResult, Content } from "../types.js";
import {
  renderWorkspaceList,
  renderFeatureList,
  renderContentList,
  renderContent,
  renderSearchResults,
  renderErrorList,
} from "./render.js";
import { listErrorLogs } from "../db/error-log.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function createApp(db: Database.Database) {
  const app = express();

  app.use("/assets", express.static(join(PACKAGE_ROOT, "assets")));

  app.get("/", (_req, res) => {
    const workspaces = listWorkspaceSummaries(db);
    const recent = listRecentContents(db);
    res.send(renderWorkspaceList(workspaces, recent));
  });

  app.get("/ws/:workspace", (req, res) => {
    const { workspace } = req.params;
    const features = listFeatures(db, workspace);
    if (features.length === 0) {
      const workspaces = listWorkspaces(db);
      const exists = workspaces.some((w) => w.name === workspace);
      if (!exists) {
        res.status(404).send(`<p>Workspace not found: ${workspace}</p>`);
        return;
      }
    }
    res.send(renderFeatureList(workspace, features));
  });

  app.get("/ws/:workspace/:feature", (req, res) => {
    const { workspace, feature } = req.params;
    const features = listFeatures(db, workspace);
    const featureExists = features.some((f) => f.name === feature);
    if (!featureExists) {
      res.status(404).send(`<p>Feature not found: ${workspace}/${feature}</p>`);
      return;
    }
    const contents = listContents(db, workspace, feature);
    res.send(renderContentList(workspace, feature, contents));
  });

  app.get("/ws/:workspace/:feature/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).send("<p>Not found</p>");
      return;
    }
    try {
      const content = getContent(db, id);
      let lineage: LineageResult | undefined;
      try { lineage = getLineage(db, id); } catch { /* no links or db error */ }
      res.send(renderContent(content, lineage));
    } catch {
      res.status(404).send("<p>Content not found</p>");
    }
  });

  app.get("/ws/:workspace/:feature/:id/export", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(404).send("<p>Not found</p>");
      return;
    }
    try {
      const content = getContent(db, id);
      const filename = slugifyTitle(content.title ?? `content-${id}`);
      const body = buildExportBody(content);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.md"`);
      res.send(body);
    } catch {
      res.status(404).send("<p>Content not found</p>");
    }
  });

  app.get("/errors", (_req, res) => {
    const errors = listErrorLogs(db);
    res.send(renderErrorList(errors));
  });

  app.get("/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const workspace =
      typeof req.query.workspace === "string" ? req.query.workspace : undefined;
    if (!q) {
      res.redirect("/");
      return;
    }
    const page = await searchSemantic(db, q, workspace).catch(() => ({ results: [], has_more: false, total_in_pool: 0, offset: 0, limit: 10 }));
    res.send(renderSearchResults(q, page.results, workspace));
  });

  return app;
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "content";
}

function buildExportBody(content: Content): string {
  const exported = new Date().toISOString().slice(0, 10);
  const frontmatter = [
    "---",
    `title: ${content.title ?? ""}`,
    `type: ${content.type}`,
    `feature: ${content.feature}`,
    `workspace: ${content.workspace}`,
    `exported: ${exported}`,
    "---",
    "",
  ].join("\n");
  return frontmatter + content.body;
}
