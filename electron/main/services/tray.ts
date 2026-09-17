import { Menu, Tray, app, nativeImage } from "electron";
import { join } from "path";
import { createSettingsWindow } from "@main/window/settings";
import {
  closeTaskbarLyricWindow,
  createTaskbarLyricWindow,
} from "@main/window/taskbarLyric";
import { coreLog } from "@main/utils/logger";

let tray: Tray | null = null;

/** 图标路径：开发时读项目 resources，打包后读 resourcesPath */
const trayIconPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, "logo.ico")
    : join(__dirname, "../../../resources/logo.ico");

/** 构建托盘右键菜单 */
const buildMenu = (): Menu =>
  Menu.buildFromTemplate([
    { label: "设置…", click: () => createSettingsWindow() },
    { type: "separator" },
    {
      label: "重建任务栏嵌入",
      click: () => {
        closeTaskbarLyricWindow();
        setTimeout(() => createTaskbarLyricWindow(), 300);
      },
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);

/** 创建托盘图标与菜单 */
export const createTray = (): void => {
  if (process.platform !== "win32") return;
  try {
    const icon = nativeImage.createFromPath(trayIconPath());
    tray = new Tray(icon);
    tray.setToolTip("LyricBar");
    tray.setContextMenu(buildMenu());
    tray.on("double-click", () => createSettingsWindow());
    coreLog.info("[tray] 托盘已创建");
  } catch (error) {
    coreLog.error("[tray] 托盘创建失败", error);
  }
};

/** 销毁托盘（退出前调用） */
export const destroyTray = (): void => {
  tray?.destroy();
  tray = null;
};
