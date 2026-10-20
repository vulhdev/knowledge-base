import { describe, it, expect, vi, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../setup.js";

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn(),
}));

// Mock config so loadSettings() returns what we want without caching issues
vi.mock("../../src/config.js", () => ({
  loadSettings: vi.fn(),
  writeSettings: vi.fn(),
}));

const WITH_IDENTITY = {
  db_path: "/db",
  model_cache_dir: "/m",
  identity: { name: "Alice", email: "alice@example.com" },
};

const WITHOUT_IDENTITY = { db_path: "/db", model_cache_dir: "/m" };

describe("createContent — created_by field", () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });

  it("stores explicit created_by when provided", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(WITH_IDENTITY);
    const { createContent } = await import("../../src/tools/create-content.js");
    const result = await createContent(db, "ws", ["ft"], "idea", "body", undefined, undefined, "Bob <bob@b.com>");
    const row = db
      .prepare("SELECT created_by FROM contents WHERE id = ?")
      .get(result.id) as { created_by: string | null };
    expect(row.created_by).toBe("Bob <bob@b.com>");
  });

  it("uses settings identity as created_by when not provided", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(WITH_IDENTITY);
    const { createContent } = await import("../../src/tools/create-content.js");
    const result = await createContent(db, "ws", ["ft"], "idea", "body");
    const row = db
      .prepare("SELECT created_by FROM contents WHERE id = ?")
      .get(result.id) as { created_by: string | null };
    expect(row.created_by).toBe("Alice <alice@example.com>");
  });

  it("leaves created_by NULL when no identity in settings and none provided", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(WITHOUT_IDENTITY);
    const { createContent } = await import("../../src/tools/create-content.js");
    const result = await createContent(db, "ws", ["ft"], "idea", "body");
    const row = db
      .prepare("SELECT created_by FROM contents WHERE id = ?")
      .get(result.id) as { created_by: string | null };
    expect(row.created_by).toBeNull();
  });
});

describe("updateContent — updated_by field", () => {
  let db: Database.Database;
  let contentId: number;

  beforeEach(async () => {
    db = createTestDb();
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(WITH_IDENTITY);
    const { createContent } = await import("../../src/tools/create-content.js");
    const res = await createContent(db, "ws", ["ft"], "idea", "original body");
    contentId = res.id;
  });

  it("stores explicit updated_by when provided", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(WITH_IDENTITY);
    const { updateContent } = await import("../../src/tools/update-content.js");
    await updateContent(db, contentId, "new body", undefined, undefined, undefined, "Bob <bob@b.com>");
    const row = db
      .prepare("SELECT updated_by FROM contents WHERE id = ?")
      .get(contentId) as { updated_by: string | null };
    expect(row.updated_by).toBe("Bob <bob@b.com>");
  });

  it("uses settings identity as updated_by when not provided", async () => {
    const { loadSettings } = await import("../../src/config.js");
    vi.mocked(loadSettings).mockReturnValue(WITH_IDENTITY);
    const { updateContent } = await import("../../src/tools/update-content.js");
    await updateContent(db, contentId, "new body");
    const row = db
      .prepare("SELECT updated_by FROM contents WHERE id = ?")
      .get(contentId) as { updated_by: string | null };
    expect(row.updated_by).toBe("Alice <alice@example.com>");
  });
});
