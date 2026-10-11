import { describe, it, expect } from "vitest";
import { createTestDb } from "../setup.js";
import { fetchWorkspaceItems } from "../../src/bin/push-helpers.js";

function seedContent(db: ReturnType<typeof createTestDb>, workspace: string, feature: string, type: string, body: string, title?: string) {
  db.prepare("INSERT OR IGNORE INTO workspaces (name) VALUES (?)").run(workspace);
  const ws = db.prepare("SELECT id FROM workspaces WHERE name = ?").get(workspace) as { id: number };
  db.prepare("INSERT OR IGNORE INTO features (workspace_id, name) VALUES (?, ?)").run(ws.id, feature);
  const ft = db.prepare("SELECT id FROM features WHERE workspace_id = ? AND name = ?").get(ws.id, feature) as { id: number };
  const { lastInsertRowid } = db
    .prepare("INSERT INTO contents (type, title, body) VALUES (?, ?, ?)")
    .run(type, title ?? null, body);
  db.prepare("INSERT INTO content_features (content_id, feature_id) VALUES (?, ?)").run(Number(lastInsertRowid), ft.id);
  return Number(lastInsertRowid);
}

describe("fetchWorkspaceItems", () => {
  it("returns empty array when workspace has no contents", () => {
    const db = createTestDb();
    db.prepare("INSERT INTO workspaces (name) VALUES ('empty-ws')").run();
    expect(fetchWorkspaceItems(db, "empty-ws")).toEqual([]);
  });

  it("returns items for a workspace", () => {
    const db = createTestDb();
    seedContent(db, "ws", "auth", "spec", "Auth body", "Auth Spec");
    seedContent(db, "ws", "search", "plan", "Search plan body");

    const items = fetchWorkspaceItems(db, "ws");
    expect(items).toHaveLength(2);

    const spec = items.find((i) => i.type === "spec");
    expect(spec?.feature).toBe("auth");
    expect(spec?.title).toBe("Auth Spec");
    expect(spec?.body).toBe("Auth body");

    const plan = items.find((i) => i.type === "plan");
    expect(plan?.feature).toBe("search");
    expect(plan?.title).toBeUndefined();
  });

  it("does not include items from other workspaces", () => {
    const db = createTestDb();
    seedContent(db, "ws1", "auth", "spec", "ws1 body");
    seedContent(db, "ws2", "auth", "spec", "ws2 body");

    const items = fetchWorkspaceItems(db, "ws1");
    expect(items).toHaveLength(1);
    expect(items[0].body).toBe("ws1 body");
  });

  it("omits title field when title is null", () => {
    const db = createTestDb();
    seedContent(db, "ws", "f", "idea", "body");

    const items = fetchWorkspaceItems(db, "ws");
    expect("title" in items[0]).toBe(false);
  });
});
