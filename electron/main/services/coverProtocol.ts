/**
 * smtc-cover:// 协议：把封面缓存目录暴露给渲染端
 *
 * 默认 session 与独立歌词窗口共用同一 session（默认 + persist:main），
 * 因此注册一次即可。
 */

import { app, protocol } from "electron";
import { join, normalize } from "path";
import { existsSync, readFileSync } from "node:fs";
import { coversDir } from "@main/utils/paths";
import { coreLog } from "@main/utils/logger";

const SCHEME = "smtc-cover";

/** 按文件头嗅探 MIME（封面源多为 JPEG/PNG/WebP） */
const sniffImageMime = (buf: Buffer): string => {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
};

/**
 * 注册 smtc-cover:// 协议
 * @returns 是否注册成功
 */
export const registerCoverProtocol = (): boolean => {
  try {
    protocol.handle(SCHEME, (request: Request) => {
      // URL 形如 smtc-cover://<key>.img
      const raw = request.url.slice(SCHEME.length + 3);
      // 规范化防目录穿越，只允许纯文件名
      const file = normalize(raw).replace(/^[/\\]+/, "");
      if (file.includes("\\") || file.includes("/") || file.startsWith(".")) {
        return new Response("forbidden", { status: 403 });
      }
      const path = join(coversDir, file);
      if (!existsSync(path)) {
        return new Response("not found", { status: 404 });
      }
      const buf = readFileSync(path);
      return new Response(buf, {
        headers: { "content-type": sniffImageMime(buf) },
      });
    });
    coreLog.info("[cover] smtc-cover:// 协议已注册");
    return true;
  } catch (error) {
    coreLog.error("[cover] 协议注册失败", error);
    return false;
  }
};
