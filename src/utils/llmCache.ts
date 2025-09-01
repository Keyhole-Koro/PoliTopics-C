import fs from "fs-extra";
import path from "node:path";
import type { LLMUsage } from "@llm/LLMClient";
import type { ChunkLLMResult, ReduceLLMResult } from "@LLMSummarize/pipeline";

function outRoot() {
  return process.env.OUT_DIR || "out";
}

function cacheRoot() {
  return path.join(outRoot(), "cache");
}

export function isLlmCacheEnabled(): boolean {
  const flag = (process.env.LLM_CACHE_ENABLED || "").toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return (process.env.APP_ENV || "").toLowerCase() === "local";
}

function safePreview(text?: string, max = 200) {
  if (!text) return undefined;
  const s = String(text);
  const p = s.slice(0, max).replace(/\n/g, "\\n");
  return s.length > max ? `${p}…` : p;
}

export async function saveChunkCache(params: {
  meetingId: string;
  chunkIndex: number;
  chunkCount: number;
  basedOnOrders?: number[];
  result?: ChunkLLMResult;
  usage?: LLMUsage;
  nonJsonText?: string;
  nonJsonS3Key?: string;
}) {
  if (!isLlmCacheEnabled()) return;
  try {
    const dir = path.join(cacheRoot(), params.meetingId, "chunks");
    await fs.ensureDir(dir);
    const file = path.join(dir, `chunk-${String(params.chunkIndex).padStart(3, "0")}.json`);
    const body = {
      meetingId: params.meetingId,
      index: params.chunkIndex,
      count: params.chunkCount,
      based_on_orders: params.basedOnOrders ?? params.result?.middle_summary?.based_on_orders ?? [],
      usage: params.usage,
      result: params.result,
      nonJson: params.nonJsonText ? { preview: safePreview(params.nonJsonText), s3Key: params.nonJsonS3Key } : undefined,
      createdAt: new Date().toISOString(),
    };
    await fs.writeJson(file, body, { spaces: 2 });
    // keep logs quiet by default
  } catch (e) {
    console.warn(`[llmCache] Failed to save chunk cache: ${params.meetingId}#${params.chunkIndex}`, e);
  }
}

export async function saveReduceCache(params: {
  meetingId: string;
  result: ReduceLLMResult;
  rawNonJsons?: Array<{ phase: "chunk" | "reduce"; index?: number; text: string; s3Key?: string; preview?: string }>;
}) {
  if (!isLlmCacheEnabled()) return;
  try {
    const dir = path.join(cacheRoot(), params.meetingId);
    await fs.ensureDir(dir);
    const file = path.join(dir, `reduce.json`);
    const body = {
      meetingId: params.meetingId,
      reduce: params.result,
      rawNonJsons: (params.rawNonJsons || []).map((r) => ({ phase: r.phase, index: r.index, preview: r.preview, s3Key: r.s3Key })),
      createdAt: new Date().toISOString(),
    };
    await fs.writeJson(file, body, { spaces: 2 });
  } catch (e) {
    console.warn(`[llmCache] Failed to save reduce cache: ${params.meetingId}`, e);
  }
}

export async function writeCombinedMeetingCache(params: {
  meetingId: string;
  chunkCount: number;
}) {
  if (!isLlmCacheEnabled()) return;
  try {
    const root = path.join(cacheRoot(), params.meetingId);
    const chunksDir = path.join(root, "chunks");
    const reduceFile = path.join(root, "reduce.json");
    const outFile = path.join(root, "llm_cache.json");

    const chunkFiles = (await fs.pathExists(chunksDir))
      ? (await fs.readdir(chunksDir))
          .filter((f) => f.toLowerCase().endsWith(".json"))
          .sort()
          .map((f) => path.join(chunksDir, f))
      : [];

    const chunks = await Promise.all(
      chunkFiles.map(async (f) => {
        try { return await fs.readJson(f); } catch { return undefined; }
      })
    );

    let reduce: any = undefined;
    if (await fs.pathExists(reduceFile)) {
      try { reduce = await fs.readJson(reduceFile); } catch { /* ignore */ }
    }

    const body = {
      meetingId: params.meetingId,
      chunkCount: params.chunkCount,
      chunks: chunks.filter(Boolean),
      reduce,
      createdAt: new Date().toISOString(),
    };

    await fs.writeJson(outFile, body, { spaces: 2 });
  } catch (e) {
    console.warn(`[llmCache] Failed to write combined cache: ${params.meetingId}`, e);
  }
}

