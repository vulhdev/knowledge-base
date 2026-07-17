import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { listWorkspaces } from "../db/workspaces.js";
import { listFeatures } from "./db.js";
import { listContents } from "../tools/list-contents.js";
import { getContent } from "../tools/get-content.js";
import { searchContent } from "../tools/search-content.js";
import {
  renderWorkspaceList,
  renderFeatureList,
  renderContentList,
  renderContent,
  renderSearchResults,
} from "./render.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function createApp(db: Database.Database) {
  const app = express();

  app.use("/assets", express.static(join(PACKAGE_ROOT, "assets")));

  app.get("/", (_req, res) => {
    const workspaces = listWorkspaces(db);
    res.send(renderWorkspaceList(workspaces));
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
      res.send(renderContent(content));
    } catch {
      res.status(404).send("<p>Content not found</p>");
    }
  });

  app.get("/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const workspace =
      typeof req.query.workspace === "string" ? req.query.workspace : undefined;
    if (!q) {
      res.redirect("/");
      return;
    }
    const results = searchContent(db, q, workspace);
    res.send(renderSearchResults(q, results, workspace));
  });

  return app;
}
