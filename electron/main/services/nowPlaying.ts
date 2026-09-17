import { EventEmitter } from "node:events";
import type { Track, PlayerState } from "@shared/types/player";
import type { LyricLine, LyricData } from "@shared/types/lyrics";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";

type NowPlayingEvents = {
  /** 歌曲切换 */
  "track-change": [{ track: Track | null }];
  /** 歌词内容变化 */
  "lyric-change": [NowPlayingSnapshot];
  /** 播放位置锚点 */
  "position-sync": [NowPlayingPositionSync];
  /** 当前曲目歌词偏移变化 */
  "lyric-offset-change": [NowPlayingLyricOffsetSync];
};

/** 当前歌曲轻量信息 */
let currentTrack: Track | null = null;
/** 当前歌曲的完整解析歌词 */
let currentLyric: LyricLine[] = [];
/** 当前激活的歌词源 */
let currentSource: LyricData = null;
/** 最近一次播放位置（毫秒） */
let lastPosition = 0;
/** lastPosition 真实成立的墙钟时刻（Date.now 毫秒），用于补偿其过期时长 */
let lastPositionAt = 0;
/** 当前是否处于播放态 */
let playing = false;
/** 完整播放状态，区分 stopped 与 paused */
let playState: PlayerState = "idle";
/** 当前播放速度倍率（SMTC 场景恒为 1.0） */
let playSpeed = 1.0;
/** 当前曲目对应的歌词偏移（ms，正值为歌词提前） */
let currentLyricOffsetMs = 0;

/** 内部事件总线 */
const emitter = new EventEmitter<NowPlayingEvents>();

/**
 * 同步当前播放状态
 * @param track - 当前曲目
 * @param lyric - 当前歌词
 * @param source - 当前歌词源
 */
export const update = (track: Track | null, lyric: LyricLine[], source: LyricData): void => {
  const trackChanged = (currentTrack?.id ?? null) !== (track?.id ?? null);
  currentTrack = track;
  currentLyric = lyric;
  currentSource = source;
  if (trackChanged) {
    emitter.emit("track-change", { track });
  }
  emitter.emit("lyric-change", snapshot());
};

/**
 * 同步播放位置
 * @param positionMs - 播放位置（毫秒）
 * @param isPlaying - 是否处于播放态
 */
export const onPosition = (positionMs: number, isPlaying: boolean): void => {
  lastPosition = positionMs;
  lastPositionAt = Date.now();
  playing = isPlaying;
  if (isPlaying) playState = "playing";
  emitter.emit("position-sync", {
    position: positionMs,
    playing: isPlaying,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt,
  });
};

/**
 * 同步播放状态
 * @param state - 引擎播放状态（idle/playing/paused/stopped）
 */
export const onPlayStateChange = (state: PlayerState): void => {
  playState = state;
  playing = state === "playing";
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state,
    speed: playSpeed,
    // 暂停态接收端不补偿延迟，恢复态不能用陈旧时间戳，故取当前时刻
    sendTimestamp: Date.now(),
  });
};

/** 拉取当前完整状态 */
export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  lyric: currentLyric,
  source: currentSource,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  // 用 position 的成立时刻，接收端据此补偿其过期时长
  sendTimestamp: lastPositionAt || Date.now(),
});

/** 清空（无可用会话时调用） */
export const clear = (): void => {
  currentTrack = null;
  currentLyric = [];
  currentSource = null;
  lastPosition = 0;
  lastPositionAt = Date.now();
  emitter.emit("lyric-change", snapshot());
  emitter.emit("position-sync", {
    position: 0,
    playing: false,
    state: "idle",
    speed: playSpeed,
    sendTimestamp: Date.now(),
  });
};

/** 订阅歌曲切换 */
export const onTrackChange = (listener: (data: { track: Track | null }) => void): (() => void) => {
  emitter.on("track-change", listener);
  return () => emitter.off("track-change", listener);
};

/** 订阅歌词内容变化 */
export const onLyricChange = (listener: (snap: NowPlayingSnapshot) => void): (() => void) => {
  emitter.on("lyric-change", listener);
  return () => emitter.off("lyric-change", listener);
};

/** 订阅播放位置锚点 */
export const onPositionSync = (listener: (data: NowPlayingPositionSync) => void): (() => void) => {
  emitter.on("position-sync", listener);
  return () => emitter.off("position-sync", listener);
};

/** 订阅歌词偏移变化（SMTC 场景恒为 0，保留接口与 SPlayer 一致） */
export const onLyricOffsetChange = (
  listener: (data: NowPlayingLyricOffsetSync) => void,
): (() => void) => {
  emitter.on("lyric-offset-change", listener);
  return () => emitter.off("lyric-offset-change", listener);
};
