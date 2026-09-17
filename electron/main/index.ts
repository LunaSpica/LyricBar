import { app, BrowserWindow, protocol } from "electron";
import { mkdirSync, existsSync } from "node:fs";
import { createTaskbarLyricWindow } from "@main/window/taskbarLyric";
import { createSettingsWindow } from "@main/window/settings";
import { registerCoverProtocol } from "@main/services/coverProtocol";
import { createTray, destroyTray } from "@main/services/tray";
import { startSmtcWatcher, stopSmtcWatcher } from "@main/services/smtc";
import { registerIpc } from "@main/ipc";
import { createLogger } from "@main/utils/logger";
import { coversDir } from "@main/utils/paths";

const coreLog = createLogger("app");

/** 单实例锁：歌词应用只允许一个实例 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    createSettingsWindow();
  });
}

/** smtc-cover:// 需在 app ready 前注册为特权协议 */
protocol.registerSchemesAsPrivileged([
  { scheme: "smtc-cover", privileges: { stream: true, supportFetchAPI: true } },
]);

// 嵌入任务栏的窗口会被 Chromium 原生遮挡检测误判为不可见，导致渲染器冻结（RAF 停摆、画面停留在旧帧）
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

app.whenReady().then(() => {
  coreLog.info("应用启动");
  try {
    if (!existsSync(coversDir)) {
      mkdirSync(coversDir, { recursive: true });
    }
  } catch (error) {
    coreLog.error("创建封面目录失败", error);
  }

  registerCoverProtocol();
  registerIpc();

  // 独立应用：启动即创建歌词窗口（嵌入任务栏），托盘承载设置与退出
  createTaskbarLyricWindow();
  startSmtcWatcher();
  createTray();
});

app.on("quit", () => {
  stopSmtcWatcher();
  destroyTray();
  for (const win of BrowserWindow.getAllWindows()) {
    win.destroy();
  }
});

/** 关闭全部窗口时保持驻留（托盘应用语义） */
app.on("window-all-closed", () => {
  // no-op：保持托盘驻留
});
