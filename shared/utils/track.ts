import type { Artist } from "../types/player";

/**
 * 格式化歌手列表
 * @param artists - 歌手列表
 * @param separator - 分隔符
 * @returns 格式化文本，无有效歌手返回空串
 */
export const formatArtists = (artists?: Artist[], separator = " / "): string =>
  (artists ?? [])
    .map((artist) => artist.name.trim())
    .filter(Boolean)
    .join(separator);
