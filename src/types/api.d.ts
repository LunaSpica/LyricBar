import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import type { TaskbarLyricSettings } from "@shared/types/settings";

/** 任务栏歌词布局事件 */
export interface TaskbarLyricLayout {
  isCentered: boolean;
  systemType: "win10" | "win11";
  isLight: boolean;
  anchor: "left" | "right";
  maxWidth: number;
}

/** window.api 类型声明（与 preload 暴露的桥一致） */
export interface WindowApi {
  config: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => void;
  };
  taskbarLyric: {
    setContentWidth: (width: number) => void;
    onLayout: (callback: (data: TaskbarLyricLayout) => void) => () => void;
    onConfigChange: (callback: (data: Partial<TaskbarLyricSettings>) => void) => () => void;
  };
  nowPlaying: {
    requestSnapshot: () => Promise<NowPlayingSnapshot>;
    onLyricChange: (callback: (snap: NowPlayingSnapshot) => void) => () => void;
    onPositionSync: (callback: (data: NowPlayingPositionSync) => void) => () => void;
    onLyricOffsetChange: (callback: (data: NowPlayingLyricOffsetSync) => void) => () => void;
  };
  player: {
    dispatch: (type: "play" | "pause" | "next" | "prev") => void;
  };
  app: {
    openSettings: () => void;
  };
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
