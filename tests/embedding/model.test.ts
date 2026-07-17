import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@huggingface/transformers", () => ({
  env: { cacheDir: "" },
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockImplementation(async (_text: string) => {
      const data = new Float32Array(384).fill(0.1);
      return { data };
    }),
  ),
}));

describe("isModelReady", () => {
  let origEnv: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    origEnv = process.env.MODEL_CACHE_DIR;
    tmpDir = join(tmpdir(), `kb-test-${Date.now()}`);
    process.env.MODEL_CACHE_DIR = tmpDir;
    // Reset module cache so isModelReady picks up new env
    vi.resetModules();
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.MODEL_CACHE_DIR;
    } else {
      process.env.MODEL_CACHE_DIR = origEnv;
    }
  });

  it("returns false when cache dir does not exist", async () => {
    const { isModelReady } = await import("../../src/embedding/model.js");
    expect(isModelReady()).toBe(false);
  });

  it("returns false when cache dir exists but is empty", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const { isModelReady } = await import("../../src/embedding/model.js");
    expect(isModelReady()).toBe(false);
  });

  it("returns true when cache dir contains model files", async () => {
    const modelDir = join(tmpDir, "Xenova", "paraphrase-multilingual-MiniLM-L12-v2");
    mkdirSync(modelDir, { recursive: true });
    // Simulate a model file being present
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(modelDir, "config.json"), "{}");

    const { isModelReady } = await import("../../src/embedding/model.js");
    expect(isModelReady()).toBe(true);
  });
});

describe("getEmbedding", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a Float32Array of length 384", async () => {
    const { getEmbedding } = await import("../../src/embedding/model.js");
    const result = await getEmbedding("hello world");
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
  });

  it("returns a new array on each call", async () => {
    const { getEmbedding } = await import("../../src/embedding/model.js");
    const a = await getEmbedding("first");
    const b = await getEmbedding("second");
    expect(a).toBeInstanceOf(Float32Array);
    expect(b).toBeInstanceOf(Float32Array);
  });
});
