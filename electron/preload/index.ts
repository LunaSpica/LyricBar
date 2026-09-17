import { contextBridge, ipcRenderer } from "electron";
import type {
  NowPlayingApi,
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import type { TaskbarLyricSettings } from "@shared/types/settings";

/** 任务栏歌词布局事件（主进程 → 渲染端） */
interface TaskbarLyricLayout {
  isCentered: boolean;
  systemType: "win10" | "win11";
  isLight: boolean;
  anchor: "left" | "right";
  maxWidth: number;
}

/**
 * 预加载桥：暴露与 SPlayer 同构的 window.api
 * 歌词窗口 / 设置窗口共用
 */

const onEvent = <T>(channel: string, callback: (data: T) => void): (() => void) => {
  // HMR / 重复注册会累积监听器，先清空再挂
  ipcRenderer.removeAllListeners(channel);
  const listener = (_event: Electron.IpcRendererEvent, data: T): void => callback(data);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api = {
  config: {
    /** 点路径读取设置 */
    get: (key: string): Promise<unknown> => ipcRenderer.invoke("config:get", key),
    /** 点路径写入设置 */
    set: (key: string, value: unknown): void => ipcRenderer.send("config:set", key, value),
  },
  taskbarLyric: {
    /** 渲染端上报内容宽度 */
    setContentWidth: (width: number): void => {
      ipcRenderer.send("taskbarLyric:setContentWidth", width);
    },
    /** 订阅布局事件（锚定方向 / 主题 / 最大宽度） */
    onLayout: (callback: (data: TaskbarLyricLayout) => void) =>
      onEvent<TaskbarLyricLayout>("taskbarLyric:layout", callback),
    /** 订阅设置变更 */
    onConfigChange: (callback: (data: Partial<TaskbarLyricSettings>) => void) =>
      onEvent<Partial<TaskbarLyricSettings>>("taskbarLyric:configChange", callback),
  },
  nowPlaying: {
    /** 拉取当前完整快照 */
    requestSnapshot: (): Promise<NowPlayingSnapshot> => ipcRenderer.invoke("nowPlaying:requestSnapshot"),
    /** 订阅歌词内容变化 */
    onLyricChange: (callback: (snap: NowPlayingSnapshot) => void) =>
      onEvent<NowPlayingSnapshot>("nowPlaying:lyric-change", callback),
    /** 订阅播放位置锚点（5Hz） */
    onPositionSync: (callback: (data: NowPlayingPositionSync) => void) =>
      onEvent<NowPlayingPositionSync>("nowPlaying:position-sync", callback),
    /** 订阅歌词偏移变化 */
    onLyricOffsetChange: (callback: (data: NowPlayingLyricOffsetSync) => void) =>
      onEvent<NowPlayingLyricOffsetSync>("nowPlaying:lyric-offset-change", callback),
  } satisfies NowPlayingApi,
  player: {
    /** 发送播放控制命令：play | pause | next | prev */
    dispatch: (type: string): void => ipcRenderer.send("player:dispatch", type),
  },
  app: {
    /** 打开设置窗口 */
    openSettings: (): void => ipcRenderer.send("app:openSettings"),
  },
};

contextBridge.exposeInMainWorld("api", api);
