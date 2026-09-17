import { BrowserWindow, nativeTheme } from "electron";
import { join } from "path";

const getDefaultOptions = (): Electron.BrowserWindowConstructorOptions => ({
  autoHideMenuBar: true,
  show: false,
  backgroundColor: nativeTheme.shouldUseDarkColors ? "#101014" : "#f6f6f6",
  webPreferences: {
    preload: join(__dirname, "../preload/index.js"),
    sandbox: false,
    webgl: false,
    spellcheck: false,
    enableWebSQL: false,
    backgroundThrottling: true,
    v8CacheOptions: "code",
  },
});

/**
 * 通用窗口创建方法，仅负责合并配置并创建 BrowserWindow 实例
 * @param options - 覆盖默认配置的参数
 */
export const createWindow = (
  options: Electron.BrowserWindowConstructorOptions = {},
): BrowserWindow => {
  const defaultOptions = getDefaultOptions();

  return new BrowserWindow({
    ...defaultOptions,
    ...options,
    webPreferences: {
      ...defaultOptions.webPreferences,
      ...options.webPreferences,
    },
  });
};
