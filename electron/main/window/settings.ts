import { BrowserWindow } from "electron";
import { join } from "path";
import { createWindow } from "./create";

let settingsWindow: BrowserWindow | null = null;

/** 获取设置窗口实例（未创建或已销毁时返回 null） */
export const getSettingsWindow = (): BrowserWindow | null =>
  settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null;

/** 创建或激活设置窗口 */
export const createSettingsWindow = (): BrowserWindow | null => {
  const existing = getSettingsWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }

  settingsWindow = createWindow({
    width: 420,
    height: 720,
    minWidth: 360,
    minHeight: 560,
    title: "LyricBar · 设置",
    autoHideMenuBar: true,
    webPreferences: {
      zoomFactor: 1.0,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    settingsWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/settings/index.html`,
    );
  } else {
    settingsWindow.loadFile(
      join(__dirname, "../renderer/windows/settings/index.html"),
    );
  }

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  return settingsWindow;
};
