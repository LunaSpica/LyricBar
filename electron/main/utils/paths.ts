import { app } from "electron";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableUserData = path.join(process.env.PORTABLE_EXECUTABLE_DIR, "UserData");
  if (!existsSync(portableUserData)) mkdirSync(portableUserData, { recursive: true });
  app.setPath("userData", portableUserData);
}

/** 统一数据根目录：与 Chromium 缓存隔开，便于备份迁移 */
export const dataRoot = path.join(app.getPath("userData"), "app-data");

/** 配置目录：settings.json */
export const configDir = path.join(dataRoot, "config");

/** 缓存根目录：covers */
export const cacheDir = path.join(dataRoot, "cache");

/** 封面缓存目录 */
export const coversDir = path.join(cacheDir, "covers");

/** 日志根目录 */
export const logsDir = path.join(dataRoot, "logs");
