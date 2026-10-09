import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("../../src/embedding/tokenizer.js");

vi.mock("../../src/embedding/model.js", () => ({
  isModelReady: vi.fn().mockReturnValue(false),
  getEmbedding: vi.fn(),
}));

const fromPretrained = vi.fn();
const transformersEnv: { cacheDir?: string } = {};
vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: { from_pretrained: (...args: unknown[]) => fromPretrained(...args) },
  env: transformersEnv,
}));

vi.mock("../../src/config.js", () => ({
  loadSettings: () => ({ db_path: "/tmp/none.db", model_cache_dir: "/tmp/kb-models-test" }),
}));

describe("getTokenCounter", () => {
  beforeEach(async () => {
    vi.resetModules();
    fromPretrained.mockReset();
  });

  it("falls back to a deterministic approximation when the model is not ready", async () => {
    const { getTokenCounter, approxTokenCount } = await import("../../src/embedding/tokenizer.js");
    const count = await getTokenCounter();
    expect(count("端数処理")).toBe(4);
    expect(count("hello world")).toBe(2 + 2);
    expect(count("abcdefgh 原価")).toBe(2 + 2);
    expect(count).toBe(approxTokenCount);
    expect(fromPretrained).not.toHaveBeenCalled();
  });

  it("uses the local tokenizer when the model is ready, without network", async () => {
    const model = await import("../../src/embedding/model.js");
    vi.mocked(model.isModelReady).mockReturnValue(true);
    fromPretrained.mockResolvedValue({ encode: (t: string) => Array.from(t) });
    const { getTokenCounter } = await import("../../src/embedding/tokenizer.js");
    const count = await getTokenCounter();
    expect(count("abc")).toBe(3);
    expect(fromPretrained).toHaveBeenCalledWith(
      "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
      expect.objectContaining({ local_files_only: true }),
    );
    expect(transformersEnv.cacheDir).toBe("/tmp/kb-models-test");
  });

  it("falls back to the approximation when loading the tokenizer throws", async () => {
    const model = await import("../../src/embedding/model.js");
    vi.mocked(model.isModelReady).mockReturnValue(true);
    fromPretrained.mockRejectedValue(new Error("offline"));
    const { getTokenCounter, approxTokenCount } = await import("../../src/embedding/tokenizer.js");
    expect(await getTokenCounter()).toBe(approxTokenCount);
  });
});
