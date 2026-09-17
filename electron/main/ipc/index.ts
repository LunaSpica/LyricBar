import { ipcMain } from "electron";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { coreLog } from "@main/utils/logger";
import {
  applyTaskbarLyricLayout,
  updateTaskbarLyricContentWidth,
} from "@main/window/taskbarLyric";
import { createSettingsWindow } from "@main/window/settings";
import { controlSmtc } from "@main/services/smtc";
import * as nowPlaying from "@main/services/nowPlaying";

/**
 * 注册全部 IPC
 *
 * - config:get / config:set      点路径读写设置
 * - taskbarLyric:setContentWidth 渲染端内容宽度上报
 * - player:dispatch              hover 控件的播放控制
 * - app:openSettings             双击歌词打开设置
 * - nowPlaying:requestSnapshot   歌词窗口初始快照
 */
export const registerIpc = (): void => {
  ipcMain.handle("config:get", (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.on("config:set", (_event, key: string, value: unknown) => {
    store.set(key, value);
    onConfigChanged(key);
  });

  ipcMain.on("taskbarLyric:setContentWidth", (_event, width: number) => {
    updateTaskbarLyricContentWidth(width);
  });

  ipcMain.on("player:dispatch", (_event, type: string) => {
    // SPlayer 语义：play/pause/next/prev → SMTC 控制命令
    if (["play", "pause", "next", "prev"].includes(type)) {
      controlSmtc(type);
    }
  });

  ipcMain.on("app:openSettings", () => {
    createSettingsWindow();
  });

  ipcMain.handle("nowPlaying:requestSnapshot", () => nowPlaying.snapshot());

  // 播放状态推送 → 全部窗口（hidden = silent：隐藏窗口不收高频位置推送）
  nowPlaying.onLyricChange((snap) => broadcast("nowPlaying:lyric-change", snap, true));
  nowPlaying.onPositionSync((data) => broadcast("nowPlaying:position-sync", data, true));
  nowPlaying.onLyricOffsetChange((data) => broadcast("nowPlaying:lyric-offset-change", data, true));

  coreLog.info("[ipc] IPC 已注册");
};

/** 设置变更后的联动：任务栏布局重算 + 配置广播 */
const onConfigChanged = (key: string): void => {
  if (key.startsWith("taskbarLyric.")) {
    applyTaskbarLyricLayout();
    broadcast("taskbarLyric:configChange", store.get("taskbarLyric"));
  }
};
