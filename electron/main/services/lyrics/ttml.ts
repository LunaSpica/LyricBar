/**
 * AMLL TTML DB 抓取（逐字歌词覆盖源）
 *
 * URL 模板 %p（平台目录）/ %s（id）；NCM → "ncm-lyrics"。
 * 8s 超时 + inflight 去重 + 正/负缓存（负缓存 72h，正缓存永久）。
 */

import { store } from "@main/store";
import { lyricLog } from "@main/utils/logger";

const TIMEOUT_MS = 8000;
/** 负缓存时长：72h */
const NEGATIVE_TTL_MS = 72 * 60 * 60 * 1000;
/** 正缓存条目上限 */
const MAX_POSITIVE_ENTRIES = 300;

const inflight = new Map<string, Promise<string | null>>();
const positiveCache = new Map<string, string>();
const negativeCache = new Map<string, number>();

const cacheKey = (platform: string, id: string): string => `${platform}:${id}`;

const getCachedTTML = (platform: string, id: string): string | "miss" | null => {
  const key = cacheKey(platform, id);
  const hit = positiveCache.get(key);
  if (hit) return hit;
  const negAt = negativeCache.get(key);
  if (negAt !== undefined) {
    if (Date.now() - negAt < NEGATIVE_TTL_MS) return null;
    negativeCache.delete(key);
  }
  return "miss";
};

const setCachedTTML = (platform: string, id: string, content: string | null): void => {
  const key = cacheKey(platform, id);
  if (content) {
    if (positiveCache.size >= MAX_POSITIVE_ENTRIES) {
      const oldest = positiveCache.keys().next().value;
      if (oldest !== undefined) positiveCache.delete(oldest);
    }
    positiveCache.set(key, content);
  } else {
    negativeCache.set(key, Date.now());
  }
};

/** 真正发起一次抓取，处理缓存读写、URL 拼装、错误分类 */
const doFetch = async (platform: string, id: string): Promise<string | null> => {
  if (!store.get("lyric.enableOnlineTTMLLyric")) return null;

  const cached = getCachedTTML(platform, id);
  if (cached !== "miss") return cached;

  const tmpl = store.get("lyric.amllDbServer") as string;
  if (!tmpl || !tmpl.includes("%p") || !tmpl.includes("%s")) return null;

  const path = platform === "netease" ? "ncm-lyrics" : "qq-lyrics";
  const url = tmpl.replace("%p", path).replace("%s", encodeURIComponent(id));

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 200) {
      const content = await res.text();
      // 接口偶尔会返回 200 但 body 为空，按负缓存处理
      if (!content.trim()) {
        setCachedTTML(platform, id, null);
        return null;
      }
      setCachedTTML(platform, id, content);
      return content;
    }
    if (res.status === 404) {
      setCachedTTML(platform, id, null);
      return null;
    }
    // 其它状态码（5xx 等）不写缓存，下次重试
    lyricLog.warn(`[ttml] ${platform}:${id} HTTP ${res.status}`);
    return null;
  } catch (err) {
    lyricLog.warn(`[ttml] ${platform}:${id} fetch failed:`, err);
    return null;
  }
};

/** 单 id 抓取 + inflight 去重，仅内部使用 */
const fetchOne = (platform: string, id: string): Promise<string | null> => {
  const key = `${platform}:${id}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = doFetch(platform, id).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

/**
 * 依次尝试多个候选 id，命中即停
 * @param platform - 平台（ncm-lyrics / qq-lyrics）
 * @param ids - 候选 id 列表
 * @returns TTML 原文，未命中返回 null
 */
export const fetchTTML = async (platform: string, ids: readonly string[]): Promise<string | null> => {
  for (const id of ids) {
    if (!id) continue;
    const result = await fetchOne(platform, id);
    if (result) return result;
  }
  return null;
};

/**
 * 预热抓取：在 id 已确定的最早瞬间发出 TTML 请求
 * @param platform - 平台
 * @param ids - 候选 id 列表
 */
export const prefetchTTML = (platform: string, ids: readonly string[]): void => {
  void fetchTTML(platform, ids);
};
