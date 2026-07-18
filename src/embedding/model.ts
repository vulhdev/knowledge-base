import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { loadSettings } from "../config.js";

const MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

function getModelCacheDir(): string {
  return loadSettings().model_cache_dir;
}

function getLocalModelDir(): string {
  return join(getModelCacheDir(), "Xenova", "paraphrase-multilingual-MiniLM-L12-v2");
}

export function isModelReady(): boolean {
  const dir = getLocalModelDir();
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

type FeatureExtractionPipeline = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

let pipelineInstance: FeatureExtractionPipeline | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelineInstance) return pipelineInstance;

  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = getModelCacheDir();

  pipelineInstance = await pipeline("feature-extraction", MODEL_NAME) as unknown as FeatureExtractionPipeline;
  return pipelineInstance;
}

export async function getEmbedding(text: string): Promise<Float32Array> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}
