/**
 * SMTC 接入服务
 *
 * 加载原生 SmtcWatcher 订阅系统媒体会话，把 JSON 事件转换成：
 *  - Track 构造（id 用 source+title+artist 摘要，稳定可缓存）
 *  - 歌词解析（异步，命中后经 nowPlaying.update 广播）
 *  - 位置锚点（200ms 定时器把锚点插值后以 5Hz 推给歌词窗口）
 *  - 播放控制（play/pause/next/prev 透传给当前会话）
 *
 * 网易云 Win32 客户端不维护 SMTC 时间轴（Position/LastUpdated 恒零值），只有
 * status 可用；其主窗口进度条经 UIA（uiaPosition 事件）可读到亚秒级真实进度，
 * 用于 seek 感知与锚点纠偏。
 */

import { loadNativeModule } from "@main/utils/nativeLoader";
import { coversDir } from "@main/utils/paths";
import { smtcLog } from "@main/utils/logger";
import { store } from "@main/store";
import { resolveLyric } from "./lyrics/lyricService";
import * as nowPlaying from "./nowPlaying";
import type { Track, PlayerState } from "@shared/types/player";
import type { SmtcWatcher as NapiSmtcWatcher } from "@splayer/smtc-lyric";

interface SmtcSnapshot {
  source: string;
  title: string;
  artist: string;
  album: string;
  status:
    | "playing"
    | "paused"
    | "stopped"
    | "closed"
    | "changing"
    | "opened"
    | "unknown";
  positionMs: number;
  lastUpdatedMs: number;
  durationMs: number;
  coverKey?: string;
}

let watcher: NapiSmtcWatcher | null = null;
/** 当前会话快照 */
let currentSnap: SmtcSnapshot | null = null;
/** 歌词解析竞态 token：切歌后旧解析结果不再生效 */
let resolveToken = 0;
/** 位置同步定时器 */
let positionTimer: ReturnType<typeof setInterval> | null = null;
/** 时间轴缺失时的兜底插值锚点 */
let fallbackAnchor: { posMs: number; wallMs: number } | null = null;
/** 锚点是否处于播放推进态：暂停只在进入的第一拍结算一次，之后完全冻结 */
let anchorPlaying = false;
/** 最近一次网易云滑杆读数（含时刻）：暂停结算与恢复重定基时的位置真值 */
let lastUiaSample: { posMs: number; at: number } | null = null;
/** 已持久化的最近活跃会话 source，避免每次快照重复写盘 */
let lastSavedSource = String(store.get("smtc.lastSource") ?? "");

/** UIA 滑杆读数与锚点外推的重锚阈值：seek 或累积漂移超过即重锚 */
const UIA_REANCHOR_MS = 1200;

/** 歌手串拆分为 Artist 列表（SMTC 只给一个文本字段） */
const parseArtists = (artistText: string): Array<{ name: string }> =>
  artistText
    .split(/[、&;，,/|·・]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));

/** SMTC 状态映射到播放状态 */
const toPlayerState = (status: SmtcSnapshot["status"]): PlayerState => {
  if (status === "playing") return "playing";
  if (status === "paused") return "paused";
  if (status === "changing") return "loading";
  return "stopped";
};

/** 由 SMTC 快照构造 Track（id 稳定，封面按 coverKey 指向本地缓存文件） */
const buildTrack = (snap: SmtcSnapshot): Track => {
  const hashSource = `${snap.source}\n${snap.title}\n${snap.artist}\n${snap.album}`;
  let hash: number = 5381;
  for (let i = 0; i < hashSource.length; i++) {
    hash = ((hash << 5) ^ hash ^ hashSource.charCodeAt(i)) | 0;
  }
  const coverUrl = snap.coverKey ? `smtc-cover://${snap.coverKey}.img` : null;
  return {
    id: `smtc:${(hash >>> 0).toString(16)}`,
    title: snap.title || "未知歌曲",
    artists: parseArtists(snap.artist),
    album: snap.album ? { name: snap.album } : undefined,
    duration: snap.durationMs,
    cover: coverUrl,
  };
};

/** 启动歌词解析（切歌时调用），完成后广播 */
const startResolveLyric = (track: Track): void => {
  const token = ++resolveToken;
  void resolveLyric(track).then((result) => {
    if (token !== resolveToken || !currentSnap) return;
    nowPlaying.update(track, result?.lines ?? [], result?.source ?? null);
  });
};

/** 快照事件处理：更新锚点、播放状态、按需触发歌词解析 */
const handleSnapshot = (snap: SmtcSnapshot): void => {
  const prev = currentSnap;
  currentSnap = snap;

  const mediaChanged =
    !prev ||
    prev.source !== snap.source ||
    prev.title !== snap.title ||
    prev.artist !== snap.artist;

  // 切歌必须重锚：无时间轴的播放器 positionMs 恒为 0，靠位置变化感知不到切歌
  if (mediaChanged) {
    resetFallbackAnchor();
    startResolveLyric(buildTrack(snap));
  }

  // 记住最近活跃的会话，冷启动时粘性选择优先回到它（如网易云暂停态不被 Chrome 抢走）
  if (snap.source !== lastSavedSource) {
    lastSavedSource = snap.source;
    store.set("smtc.lastSource", snap.source);
  }

  pushPosition();
  if (prev?.status !== snap.status) {
    nowPlaying.onPlayStateChange(toPlayerState(snap.status));
  }
};

/** 封面落盘完成后更新 Track 并重广播 */
const onCoverReady = (key: string): void => {
  if (!currentSnap) return;
  currentSnap.coverKey = key;
  const snap = nowPlaying.snapshot();
  const track = buildTrack(currentSnap);
  nowPlaying.update(track, snap.lyric, snap.source);
};

/**
 * 启动 SMTC watcher 与位置同步循环
 * @returns 启动是否成功（非 Windows 或模块缺失时为 false）
 */
export const startSmtcWatcher = (): boolean => {
  if (process.platform !== "win32") {
    smtcLog.warn("SMTC 仅支持 Windows");
    return false;
  }

  const mod = loadNativeModule<typeof import("@splayer/smtc-lyric")>(
    "smtc-lyric.node",
    "smtc-lyric",
  );
  if (!mod) {
    smtcLog.error("SMTC 原生模块加载失败");
    return false;
  }

  watcher = new mod.SmtcWatcher(coversDir, lastSavedSource, (json) => {
    try {
      const event = JSON.parse(json) as { type: string; key?: string } & Record<
        string,
        unknown
      >;
      if (event.type === "snapshot") {
        handleSnapshot(event as unknown as SmtcSnapshot);
      } else if (event.type === "cover" && event.key) {
        onCoverReady(event.key);
      } else if (event.type === "uiaPosition") {
        handleUiaPosition(Number(event.posMs), Number(event.durationMs));
      } else if (event.type === "uiaTrack") {
        handleUiaTrack(String(event.title));
      } else if (event.type === "uiaLine") {
        handleUiaLine(String(event.text));
      } else if (event.type === "none") {
        currentSnap = null;
        nowPlaying.clear();
      }
    } catch (error) {
      smtcLog.warn("解析 SMTC 事件失败", error);
    }
  });

  positionTimer = setInterval(pushPosition, 200);
  return true;
};

/** 停止 SMTC watcher 与位置同步循环 */
export const stopSmtcWatcher = (): void => {
  if (positionTimer) {
    clearInterval(positionTimer);
    positionTimer = null;
  }
  watcher?.stop();
  watcher = null;
};

/**
 * 向当前会话发送控制命令
 * @param action - play | pause | next | prev
 */
export const controlSmtc = (action: string): void => {
  watcher?.control(action);
};

/**
 * 按 SMTC 锚点插值出当前播放位置并推给歌词窗口
 *
 * SMTC 的 TimelineProperties 只在切歌/seek 等时更新，需要墙钟外推。
 * 部分播放器（如网易云 Win32 客户端）不维护时间轴：lastUpdatedMs/endTime 为零值——
 * 此时用内部计时器兜底：切歌时重锚到 0，暂停时冻结，恢复时从冻结处继续；
 * seek 与冷启动纠偏由 uiaPosition 读数重锚感知。
 */
const pushPosition = (): void => {
  const snap = currentSnap;
  if (!snap) return;
  if (timelineAlive(snap)) {
    // 时间轴可用：直接按 SMTC 锚点外推
    if (snap.status === "playing") {
      const elapsed = Math.max(0, Date.now() - snap.lastUpdatedMs);
      nowPlaying.onPosition(snap.positionMs + elapsed, true);
    } else {
      nowPlaying.onPosition(snap.positionMs, false);
    }
    return;
  }
  // 时间轴缺失：内部计时器兜底
  if (snap.status === "playing") {
    if (!fallbackAnchor) {
      fallbackAnchor = { posMs: 0, wallMs: Date.now() };
      anchorPlaying = true;
    } else if (!anchorPlaying) {
      resumeAnchor();
    }
    nowPlaying.onPosition(
      fallbackAnchor.posMs + (Date.now() - fallbackAnchor.wallMs),
      true,
    );
    return;
  }
  // 暂停/停止：结算到当前真实位置后冻结，恢复时从这里继续
  if (anchorPlaying && fallbackAnchor) {
    pauseAnchor();
  }
  nowPlaying.onPosition(
    fallbackAnchor ? fallbackAnchor.posMs : snap.positionMs,
    false,
  );
};

/**
 * 恢复播放时的锚点重定基：优先采用最近的滑杆读数作为起点。
 * SMTC 恢复事件常晚于音频实际开始，若直接从旧冻结点计时，
 * 每次暂停/恢复循环都会累积一次事件延迟的落后
 */
const resumeAnchor = (): void => {
  if (!fallbackAnchor) return;
  const sample = lastUiaSample;
  if (
    sample &&
    Date.now() - sample.at < 3000 &&
    Math.abs(sample.posMs - fallbackAnchor.posMs) < 5000 &&
    Math.abs(sample.posMs - fallbackAnchor.posMs) > 400
  ) {
    fallbackAnchor.posMs = sample.posMs;
  }
  fallbackAnchor.wallMs = Date.now();
  anchorPlaying = true;
};

/**
 * 暂停结算：把锚点落到暂停瞬间的真实位置后冻结。
 * SMTC 暂停事件可能晚到（结算前锚点还在按播放外推），用最近的滑杆
 * 读数（暂停后冻结在音频真实停止点）修正，避免每次暂停产生超前偏差
 */
const pauseAnchor = (): void => {
  if (!fallbackAnchor) return;
  const extrapolated =
    fallbackAnchor.posMs + (Date.now() - fallbackAnchor.wallMs);
  const sample = lastUiaSample;
  if (
    sample &&
    Date.now() - sample.at < 3000 &&
    Math.abs(sample.posMs - extrapolated) < 5000
  ) {
    fallbackAnchor.posMs = sample.posMs;
  } else {
    fallbackAnchor.posMs = extrapolated;
  }
  fallbackAnchor.wallMs = Date.now();
  anchorPlaying = false;
};

/** 时间轴是否可用：零值 FILETIME 会算出负数 lastUpdatedMs，未来时刻视为无效 */
const timelineAlive = (snap: SmtcSnapshot): boolean =>
  snap.lastUpdatedMs > 0 && snap.lastUpdatedMs <= Date.now() + 60_000;

/**
 * 应用网易云主窗口滑杆读数：偏离锚点外推超过阈值即视为 seek/漂移，直接重锚。
 * 同时顺带修正 SMTC 元数据早于音频发出的锚定提前，并在冷启动时直接对齐真实进度
 * @param posMs - 滑杆读出的当前位置（毫秒）
 * @param durationMs - 滑杆 Maximum 换算的总时长（毫秒）
 */
const handleUiaPosition = (posMs: number, durationMs: number): void => {
  const snap = currentSnap;
  // 有时间轴的会话由 SMTC 外推负责，UIA 读数只兜底无时间轴的网易云
  if (!snap || timelineAlive(snap) || !snap.source.includes("cloudmusic")) {
    return;
  }

  const now = Date.now();
  lastUiaSample = { posMs, at: now };

  if (!fallbackAnchor) {
    fallbackAnchor = { posMs, wallMs: now };
    anchorPlaying = snap.status === "playing";
    pushPosition();
  } else {
    const expected = anchorExpected();
    if (Math.abs(posMs - expected) > UIA_REANCHOR_MS) {
      fallbackAnchor = { posMs, wallMs: now };
      anchorPlaying = snap.status === "playing";
      pushPosition();
    }
  }

  if (durationMs > 0 && snap.durationMs !== durationMs) {
    snap.durationMs = durationMs;
    const current = nowPlaying.snapshot();
    nowPlaying.update(buildTrack(snap), current.lyric, current.source);
  }
};

/**
 * 应用网易云窗口标题兜底切歌感知（"标题 - 歌手"）。
 * 歌单自然播完切歌时 SMTC 元数据可能不更新，标题是唯一可靠的切歌信号
 * @param rawTitle - UIA 读到的窗口标题，如 "Lying from You - Linkin Park"
 */
const handleUiaTrack = (rawTitle: string): void => {
  const snap = currentSnap;
  const separator = rawTitle.lastIndexOf(" - ");
  if (!snap || !snap.source.includes("cloudmusic") || separator <= 0) return;

  const title = rawTitle.slice(0, separator);
  const artist = rawTitle.slice(separator + 3);
  if (!title || !artist || title === snap.title) return;

  snap.title = title;
  snap.artist = artist;
  resetFallbackAnchor();
  startResolveLyric(buildTrack(snap));
  pushPosition();
};

/** 切歌时强制重锚到 0：无时间轴的播放器 positionMs 恒为 0，不能靠位置变化感知切歌 */
const resetFallbackAnchor = (): void => {
  fallbackAnchor = null;
  anchorPlaying = false;
};

/** 当前网易云锚点外推位置（与 pushPosition 的插值口径一致） */
const anchorExpected = (): number => {
  const snap = currentSnap;
  if (!fallbackAnchor || !snap) return 0;
  return snap.status === "playing" && anchorPlaying
    ? fallbackAnchor.posMs + (Date.now() - fallbackAnchor.wallMs)
    : fallbackAnchor.posMs;
};

/**
 * 应用播放页当前歌词行读数：中位行即网易云当前高亮行，行文本与已解析歌词
 * 匹配后校验锚点。行粒度（秒级）兜底，用于滑杆通道缺失时的漂移/seek 纠偏
 * @param text - UIA 读到的歌词行文本（中文行或英文行均可匹配）
 */
const handleUiaLine = (text: string): void => {
  const snap = currentSnap;
  if (!snap || timelineAlive(snap) || !snap.source.includes("cloudmusic")) {
    return;
  }
  const lyric = nowPlaying.snapshot().lyric;
  if (!lyric.length) return;

  const reported = text.trim();
  if (!reported) return;
  const expected = anchorExpected();
  let best: { start: number; end: number } | null = null;
  let bestMid = 0;
  for (const line of lyric) {
    if (line.isBG) continue;
    const lineText = line.words
      .map((w) => w.word)
      .join("")
      .trim();
    if (lineText !== reported) continue;
    const start = line.startTime;
    const end = line.endTime > line.startTime ? line.endTime : line.startTime;
    const mid = (start + end) / 2;
    if (!best || Math.abs(mid - expected) < Math.abs(bestMid - expected)) {
      best = { start, end };
      bestMid = mid;
    }
  }
  if (!best) return;

  // 外推位置仍落在该行跨度内则视为一致，不打断插值
  if (expected >= best.start - 800 && expected <= best.end + 800) return;

  fallbackAnchor = {
    posMs: best.start + Math.min((best.end - best.start) / 2, 2000),
    wallMs: Date.now(),
  };
  anchorPlaying = snap.status === "playing";
  lastUiaSample = { posMs: fallbackAnchor.posMs, at: Date.now() };
  pushPosition();
};
