import type { LyricFormat, LyricLine, LyricInput, LyricResult, LyricWord, LyricSpan } from "lyric-kit";

export type { LyricFormat, LyricLine, LyricInput, LyricWord, LyricSpan };
export type { LyricResult, LyricMetadata } from "lyric-kit";

/** 歌词来源 */
export type LyricSource = "external" | "embedded" | "online";

/** 歌词数据（标识当前生效的歌词源） */
export type LyricData = {
  source: LyricSource;
  format: LyricFormat;
  /** 在线歌词所属平台标识 */
  platform?: string;
} | null;

/** 歌词匹配结果 */
export interface LyricMatchResult extends LyricInput {
  platform: string;
  format: LyricFormat;
  translation?: string;
  translationFormat?: LyricFormat;
  romaji?: string;
  romajiFormat?: LyricFormat;
}
