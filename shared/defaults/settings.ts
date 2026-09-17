import type { TaskbarLyricSettings, Settings } from "../types/settings";

/** 任务栏歌词默认设置（与 SPlayer 保持一致） */
export const DEFAULT_TASKBAR_LYRIC: TaskbarLyricSettings = {
  position: "auto",
  autoMaxWidth: true,
  autoAdjustOccupiedSpace: false,
  maxWidth: 400,
  leftMargin: 0,
  rightMargin: 0,
  colorMode: "taskbar",
  showBackground: false,
  doubleLine: true,
  showTranslation: true,
  showCover: true,
  wordByWord: true,
  fontSize: 14,
  fontWeight: 400,
  fontFamily: "",
};

/** 全部设置默认值 */
export const DEFAULT_SETTINGS: Settings = {
  taskbarLyric: DEFAULT_TASKBAR_LYRIC,
  lyric: {
    enableOnlineTTMLLyric: true,
    amllDbServer: "https://amlldb.bikonoo.com/%p/%s.ttml",
  },
  lyricSources: ["netease", "ttml", "lrclib"],
};
