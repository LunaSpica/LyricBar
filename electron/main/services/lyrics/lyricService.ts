/**
 * 歌词解析服务（主进程）
 *
 * 输入是 SMTC 提供的曲目元数据，流程：
 * 网易云搜索+歌词（YRC 逐字）→ AMLL TTML 逐字覆盖 → LRCLIB 同步 LRC 兜底。
 * 输出统一解析为 LyricLine[] 供歌词窗口使用；同 key 并发请求去重。
 */

import { detectFormat, parseLyric } from "lyric-kit";
import type { LyricFormat, LyricLine, LyricData, LyricMatchResult } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { store } from "@main/store";
import { lyricLog } from "@main/utils/logger";
import { callEapi } from "./netease";
import { buildLyricSearchKeyword, pickBestCandidate, type LyricCandidate } from "./candidates";
import { fetchTTML, prefetchTTML } from "./ttml";
import { searchLrc } from "./lrclib";

export interface ResolvedLyric {
  lines: LyricLine[];
  source: LyricData;
}

/** 缓存上限：内存约束 */
const MAX_CACHE_ENTRIES = 200;

/** 曲目指纹缓存：platform|指纹 → 平台歌曲 id（避免反复搜索） */
const matchedIdCache = new Map<string, string>();

/** 已解析结果缓存：track.id → 解析结果 */
const resolvedCache = new Map<string, ResolvedLyric>();

/** 进行中请求映射（同 key 共享 Promise，切歌连发只打一次网络） */
const inflight = new Map<string, Promise<ResolvedLyric | null>>();

const rememberMatchedId = (fingerprint: string, platform: string, id: string): void => {
  if (matchedIdCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = matchedIdCache.keys().next().value;
    if (oldest !== undefined) matchedIdCache.delete(oldest);
  }
  matchedIdCache.set(`${platform}|${fingerprint}`, id);
};

const getMatchedId = (fingerprint: string, platform: string): string | undefined =>
  matchedIdCache.get(`${platform}|${fingerprint}`);

const rememberResolved = (trackId: string, result: ResolvedLyric): ResolvedLyric => {
  if (resolvedCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = resolvedCache.keys().next().value;
    if (oldest !== undefined) resolvedCache.delete(oldest);
  }
  resolvedCache.set(trackId, result);
  return result;
};

/** 曲目指纹（跨平台匹配缓存 key） */
const buildFingerprint = (track: Track): string =>
  [
    track.title.toLowerCase(),
    track.artists
      .map((artist) => artist.name.trim())
      .filter(Boolean)
      .join("|")
      .toLowerCase(),
    track.duration,
  ].join("#");

/** 主歌词：yrc 优先，其次 lrc */
const pickMain = (
  yrc?: string,
  lrc?: string,
): { content: string; format: LyricFormat } | undefined => {
  const yrcContent = yrc?.trim();
  if (yrcContent) return { content: yrcContent, format: "yrc" };
  const lrcContent = lrc?.trim();
  if (lrcContent) return { content: lrcContent, format: "lrc" };
  return undefined;
};

/** 翻译/罗马音：ytlrc / yromalrc 时间戳更贴 YRC 行边界，优先选用 */
const pickSub = (yPaired?: string, plain?: string): string | undefined => {
  return yPaired?.trim() || plain?.trim() || undefined;
};

/** 网易云 lyric/v1 响应体 */
interface NeteaseLyricBody {
  code?: number;
  yrc?: { lyric?: string };
  lrc?: { lyric?: string };
  ytlrc?: { lyric?: string };
  tlyric?: { lyric?: string };
  yromalrc?: { lyric?: string };
  romalrc?: { lyric?: string };
}

/**
 * 网易云按 id 直取歌词
 * @param id - 网易云歌曲 id
 * @returns 匹配结果，无歌词返回 null
 */
const neteaseGetById = async (id: string): Promise<LyricMatchResult | null> => {
  prefetchTTML("netease", [id]);
  const body = (await callEapi("/api/song/lyric/v1", {
    id,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0,
  })) as NeteaseLyricBody | null;
  if (!body || body.code !== 200) return null;

  const main = pickMain(body.yrc?.lyric, body.lrc?.lyric);
  if (!main) return null;
  return {
    platform: "netease",
    format: main.format,
    content: main.content,
    translation: pickSub(body.ytlrc?.lyric, body.tlyric?.lyric),
    romaji: pickSub(body.yromalrc?.lyric, body.romalrc?.lyric),
  };
};

interface NeteaseSearchBody {
  code?: number;
  result?: {
    songs?: Array<{
      id: number;
      name: string;
      artists?: Array<{ name: string }>;
      album?: { name: string };
      duration?: number;
    }>;
  };
}

/**
 * 网易云按元数据模糊搜索：search → 挑最佳 → 单次请求歌词
 * @param track - 目标曲目
 * @returns 匹配结果，未命中返回 null
 */
const neteaseGetByQuery = async (track: Track): Promise<LyricMatchResult | null> => {
  const fingerprint = buildFingerprint(track);
  const cachedId = getMatchedId(fingerprint, "netease");
  if (cachedId) return neteaseGetById(cachedId);

  const keyword = buildLyricSearchKeyword(track);
  if (!keyword) return null;

  const body = (await callEapi("/api/search/get", {
    s: keyword,
    type: 1,
    limit: 20,
    offset: 0,
  })) as NeteaseSearchBody | null;
  if (!body || body.code !== 200) return null;

  const candidates: LyricCandidate<string>[] = [];
  for (const song of body.result?.songs ?? []) {
    candidates.push({
      name: song.name,
      artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
      album: song.album?.name,
      duration: song.duration,
      extra: String(song.id),
    });
  }
  const best = pickBestCandidate(candidates, track);
  lyricLog.info(
    `[netease] fuzzy "${keyword}" → ${candidates.length} hits, best=${best?.name ?? "none"}`,
  );
  if (!best) return null;
  rememberMatchedId(fingerprint, "netease", best.extra);
  return neteaseGetById(best.extra);
};

/**
 * 把匹配结果解析成 LyricLine（含翻译/罗马音），TTML 覆盖优先生效
 * @param track - 目标曲目
 * @param match - 网易云匹配结果
 * @returns 解析后的歌词行
 */
const parseMatched = async (track: Track, match: LyricMatchResult): Promise<LyricLine[]> => {
  // TTML 覆盖：AMLL DB 有更高质量的逐字时间轴
  if (store.get("lyric.enableOnlineTTMLLyric")) {
    const ttmlId = match.platform === "netease" ? extractNeteaseId(track.id) : null;
    if (ttmlId) {
      const ttml = await fetchTTML("netease", [ttmlId]);
      if (ttml) {
        const result = parseLyric(
          { content: ttml, format: "ttml" },
          { detectBackground: false, cleanKangxi: true, extractMetadata: true },
        );
        if (result.lines.length > 0) {
          ttmlUsed = true;
          return result.lines;
        }
      }
    }
  }

  const result = parseLyric(
    {
      content: match.content,
      format: match.format,
      translation: match.translation,
      translationFormat: match.translationFormat,
      romaji: match.romaji,
      romajiFormat: match.romajiFormat,
    },
    { detectBackground: false, cleanKangxi: true, extractMetadata: true },
  );
  return result.lines;
};

/** 从曲目 id（"netease:<id>"）提取平台原生 id */
const extractNeteaseId = (trackId: string): string | null => {
  const match = trackId.match(/^netease:(.+)$/);
  return match ? match[1] : null;
};

/** TTML 覆盖是否命中（解析时间统计用） */
let ttmlUsed = false;

/**
 * 解析指定曲目：缓存 → 网易云 → TTML → LRCLIB
 * @param track - 目标曲目
 * @returns 解析结果（含来源标识），无歌词返回 null
 */
export const resolveLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const cached = resolvedCache.get(track.id);
  if (cached) return cached;

  const existing = inflight.get(track.id);
  if (existing) return existing;

  const promise = (async (): Promise<ResolvedLyric | null> => {
    ttmlUsed = false;

    let match: LyricMatchResult | null = null;
    try {
      match = await neteaseGetByQuery(track);
    } catch (err) {
      lyricLog.warn(`[lyrics] netease failed for ${track.title}:`, err);
    }

    if (match) {
      const lines = await parseMatched(track, match);
      if (lines.length > 0) {
        const source: LyricData = {
          source: "online",
          format: ttmlUsed ? "ttml" : match.format,
          platform: match.platform,
        };
        lyricLog.info(
          `[lyrics] resolved "${track.title}" ← ${match.platform} ${ttmlUsed ? "ttml" : match.format}, ${lines.length} lines`,
        );
        return rememberResolved(track.id, { lines, source });
      }
      lyricLog.warn(`[lyrics] netease matched but parse empty for ${track.title}`);
    }

    const lrc = await searchLrc(track);
    if (lrc?.trim()) {
      const format = detectFormat(lrc) ?? "lrc";
      const result = parseLyric(
        { content: lrc, format },
        { detectBackground: false, cleanKangxi: true, extractMetadata: true },
      );
      if (result.lines.length > 0) {
        lyricLog.info(`[lyrics] resolved "${track.title}" ← lrclib ${format}, ${result.lines.length} lines`);
        return rememberResolved(track.id, {
          lines: result.lines,
          source: { source: "external", format },
        });
      }
    }
    lyricLog.warn(`[lyrics] no lyric found for "${track.title} / ${track.artists.map((a) => a.name).join(",")}"`);
    return null;
  })().finally(() => {
    inflight.delete(track.id);
  });

  inflight.set(track.id, promise);
  return promise;
};
