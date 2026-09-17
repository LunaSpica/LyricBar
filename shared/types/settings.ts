/** 任务栏歌词位置：auto 按任务栏对齐自动选侧 */
export type TaskbarLyricPosition = "auto" | "left" | "right";

/** 配色模式 */
export type TaskbarLyricColorMode = "taskbar" | "taskbarInverse" | "light" | "dark";

/** 任务栏歌词显示设置 */
export interface TaskbarLyricSettings {
  position: TaskbarLyricPosition;
  autoMaxWidth: boolean;
  autoAdjustOccupiedSpace: boolean;
  maxWidth: number;
  leftMargin: number;
  rightMargin: number;
  colorMode: TaskbarLyricColorMode;
  showBackground: boolean;
  doubleLine: boolean;
  showTranslation: boolean;
  showCover: boolean;
  wordByWord: boolean;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
}

/** 应用设置 */
export interface Settings {
  taskbarLyric: TaskbarLyricSettings;
  lyric: {
    /** 启用 AMLL TTML 逐字歌词覆盖 */
    enableOnlineTTMLLyric: boolean;
    /** AMLL TTML DB 地址模板，%p 平台目录 %s id */
    amllDbServer: string;
  };
  /** 歌词源优先级（从高到低） */
  lyricSources: string[];
}
