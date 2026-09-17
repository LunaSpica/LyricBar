import type { Track, PlayerState } from "./player";
import type { LyricLine, LyricData } from "./lyrics";

/** 主进程 → 歌词窗口：当前播放的完整快照 */
export interface NowPlayingSnapshot {
  track: Track | null;
  lyric: LyricLine[];
  source: LyricData;
  position: number;
  playing: boolean;
  /** 完整播放状态，区分 stopped 与 paused */
  state: PlayerState;
  /** 播放速度倍率（SMTC 场景恒为 1.0） */
  speed: number;
  /** 当前曲目的歌词偏移（ms，正值为歌词提前） */
  lyricOffsetMs: number;
  /** position 真实成立的主进程时钟（Date.now 毫秒），接收端用于补偿其过期时长 */
  sendTimestamp: number;
}

/** 主进程 → 歌词窗口：播放位置锚点 */
export interface NowPlayingPositionSync {
  position: number;
  playing: boolean;
  state: PlayerState;
  speed: number;
  sendTimestamp: number;
}

/** 主进程 → 渲染端：当前曲目歌词偏移变化 */
export interface NowPlayingLyricOffsetSync {
  trackId: string | null;
  offsetMs: number;
}

/** NowPlaying API */
export interface NowPlayingApi {
  /** 拉取当前完整快照 */
  requestSnapshot: () => Promise<NowPlayingSnapshot>;
  /** 订阅歌词内容变化 */
  onLyricChange: (callback: (snapshot: NowPlayingSnapshot) => void) => () => void;
  /** 订阅播放位置锚点 */
  onPositionSync: (callback: (data: NowPlayingPositionSync) => void) => () => void;
  /** 订阅歌词偏移变化 */
  onLyricOffsetChange: (callback: (data: NowPlayingLyricOffsetSync) => void) => () => void;
}
