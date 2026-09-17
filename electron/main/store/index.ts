import { writeFileSync as atomicWriteSync } from "atomically";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "path";
import { configDir } from "@main/utils/paths";
import { DEFAULT_SETTINGS } from "@shared/defaults/settings";
import type { Settings } from "@shared/types/settings";

const SETTINGS_FILE = path.join(configDir, "settings.json");

/** 内存中的设置快照 */
let cached: Settings = { ...DEFAULT_SETTINGS };

/** 是否已加载磁盘配置 */
let loaded = false;

/** 深度合并磁盘配置与默认值：磁盘值优先，缺失字段回退默认 */
const mergeDefaults = (disk: unknown, defaults: unknown): unknown => {
  if (defaults === null || typeof defaults !== "object") {
    return disk === undefined ? defaults : (disk ?? defaults);
  }
  if (disk === null || typeof disk !== "object") return defaults;
  const diskObj = disk as Record<string, unknown>;
  const defObj = defaults as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defObj)) {
    result[key] = mergeDefaults(diskObj[key], value);
  }
  // 保留磁盘上多出来的字段（向前兼容旧配置）
  for (const [key, value] of Object.entries(diskObj)) {
    if (!(key in result)) result[key] = value;
  }
  return result;
};

/** 加载磁盘配置（首次访问时执行） */
const ensureLoaded = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(SETTINGS_FILE)) {
      const disk = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as Record<string, unknown>;
      cached = mergeDefaults(disk, DEFAULT_SETTINGS) as Settings;
    }
  } catch (error) {
    console.error("[store] 读取 settings.json 失败，使用默认配置", error);
  }
};

/** 点路径取值：get("taskbarLyric.maxWidth") */
export const get = (key: string): unknown => {
  ensureLoaded();
  let current: unknown = cached;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

/** 点路径写入 */
const assign = (root: Record<string, unknown>, key: string, value: unknown): void => {
  const parts = key.split(".");
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === null || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
};

/**
 * 写入设置并原子落盘
 * @param key 点路径（"taskbarLyric.fontSize"）
 * @param value 写入值
 */
export const set = (key: string, value: unknown): void => {
  ensureLoaded();
  assign(cached as unknown as Record<string, unknown>, key, value);
  try {
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    atomicWriteSync(SETTINGS_FILE, JSON.stringify(cached, null, 2));
  } catch (error) {
    console.error("[store] 写入 settings.json 失败", error);
  }
};

export const store = { get, set };
