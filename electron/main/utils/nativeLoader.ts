import { app } from "electron";
import { createRequire } from "module";
import path from "path";
import { nativeLog } from "./logger";

const requireNative = createRequire(import.meta.url);

/**
 * 懒加载一个原生 .node 模块
 * @param fileName 编译后的文件名（例如 "smtc-lyric.node"）
 * @param devDirName 开发环境下的目录名，必须位于项目根目录的 native/ 下
 * @returns 加载的模块，失败返回 null
 */
export const loadNativeModule = <T = unknown>(fileName: string, devDirName: string): T | null => {
  const nativeModulePath = app.isPackaged
    ? path.join(process.resourcesPath, "native", fileName)
    : path.join(process.cwd(), "native", devDirName, fileName);

  try {
    const mod = requireNative(nativeModulePath) as T;
    nativeLog.debug(`加载 ${fileName} 成功`);
    return mod;
  } catch (error) {
    nativeLog.error(`加载 ${fileName} 失败:`, error);
    return null;
  }
};
