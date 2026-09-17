import log from "electron-log";
import { app } from "electron";
import { logsDir } from "./paths";

/** electron-log 输出到 {app-data}/logs/ 与控制台 */
log.transports.file.resolvePathFn = () => `${app.getPath("userData")}/app-data/logs/main.log`;

/** 通用作用域 logger 工厂 */
export const createLogger = (scope: string): log.LogFunctions => log.scope(`[${scope}]`);

/** 应用级日志 */
export const coreLog = createLogger("core");
/** 任务栏歌词窗口日志 */
export const taskbarLog = createLogger("taskbar");
/** SMTC 读取日志 */
export const smtcLog = createLogger("smtc");
/** 歌词匹配日志 */
export const lyricLog = createLogger("lyric");
/** 原生模块加载日志 */
export const nativeLog = createLogger("native");
