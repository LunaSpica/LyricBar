/**
 * LRCLIB 歌词兜底源（无需凭据）
 *
 * 按 track/artist/album/duration 搜索，返回同步 LRC。
 * 命中策略：统一打分（复用 pickBestCandidate），失败则放宽为关键词搜索取首条。
 */

import type { Track } from "@shared/types/player";
import { buildLyricSearchKeyword, pickBestCandidate, type LyricCandidate } from "./candidates";
import { lyricLog } from "@main/utils/logger";

interface LrcLibItem {
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const SEARCH_URL = "https://lrclib.net/api/search";
const TIMEOUT_MS = 8000;

/** LRCLIB 官方要求 User-Agent 标识应用 */
const USER_AGENT = "TaskbarLyric/0.1 (https://github.com/SPlayer-Next/TaskbarLyric)";

/** 取第一条带同步歌词的条目 */
const firstSynced = (items: LrcLibItem[]): string | null => {
  for (const item of items) {
    if (!item.instrumental && item.syncedLyrics?.trim()) return item.syncedLyrics;
  }
  return null;
};

/**
 * 按曲目元数据搜索同步歌词
 * @param track - 由 SMTC 元数据构造的曲目
 * @returns 同步 LRC 文本，未命中返回 null
 */
export const searchLrc = async (track: Track): Promise<string | null> => {
  const params = new URLSearchParams({
    track_name: track.title,
    artist_name: track.artists.map((artist) => artist.name).join(" "),
  });
  if (track.album?.name) params.set("album_name", track.album.name);
  if (track.duration > 0) params.set("duration", String(Math.round(track.duration / 1000)));

  try {
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const items = (await res.json()) as LrcLibItem[];
    if (!Array.isArray(items) || items.length === 0) return null;

    // 只接受带同步歌词的条目，归一化成 LyricCandidate 参与统一打分
    const candidates: LyricCandidate<string>[] = [];
    for (const item of items) {
      if (!item.syncedLyrics?.trim() || item.instrumental) continue;
      candidates.push({
        name: item.trackName,
        artist: item.artistName,
        album: item.albumName ?? undefined,
        duration: item.duration * 1000,
        extra: item.syncedLyrics,
      });
    }
    if (candidates.length === 0) return null;
    const best = pickBestCandidate(candidates, track);
    if (best) return best.extra;

    // 精确匹配失败时用关键词再试一次搜索接口
    const keyword = buildLyricSearchKeyword(track);
    if (!keyword) return null;
    const fallbackRes = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(keyword)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (fallbackRes.status !== 200) return null;
    return firstSynced((await fallbackRes.json()) as LrcLibItem[]);
  } catch (err) {
    lyricLog.warn(`[lrclib] search(${track.title}) failed:`, err);
    return null;
  }
};
