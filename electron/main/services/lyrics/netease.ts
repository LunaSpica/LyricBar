/**
 * 网易云音乐 eapi 精简客户端
 *
 * 只实现本应用需要的两个接口：搜索 /api/search/get 与歌词 /api/song/lyric/v1。
 * 匿名 weapi 已不可用，SPlayer 实际走的也是 eapi（iPhone 客户端伪装）：
 * AES-128-ECB + MD5 摘要签名，域名 interfacepc.music.163.com。
 */

import { createCipheriv, createHash, randomBytes, randomInt } from "node:crypto";

const EAPI_DOMAIN = "https://interfacepc.music.163.com";
const EAPI_KEY = "e82ckenh8dichen8";
const USER_AGENT = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";

/** AES-128-ECB 加密，hex 大写输出（eapi 响应体默认明文 JSON，无需解密） */
const aesEcbHex = (text: string): string => {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(EAPI_KEY), Buffer.alloc(0));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(text, "utf8")), cipher.final()]);
  return encrypted.toString("hex").toUpperCase();
};

/** eapi 三段拼接签名：url - 36cd479b6b5 - 明文 - 36cd479b6b5 - md5("nobody{url}use{text}md5forencrypt") */
const eapiParams = (path: string, data: object): string => {
  const text = JSON.stringify(data);
  const digest = createHash("md5")
    .update(`nobody${path}use${text}md5forencrypt`)
    .digest("hex");
  return aesEcbHex(`${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`);
};

/**
 * 发起一次 eapi 请求
 * @param path - 接口路径，如 /api/search/get
 * @param data - 业务参数（header 由本层注入）
 * @returns 响应体；非 200 或非 JSON 返回 null
 */
export const callEapi = async (
  path: string,
  data: object,
): Promise<Record<string, unknown> | null> => {
  const deviceId = randomBytes(26).toString("hex").toUpperCase();
  const payload = {
    ...data,
    header: {
      osver: "17.4.1",
      deviceId,
      os: "ios",
      appver: "9.0.90",
      versioncode: "140",
      mobilename: "",
      buildver: "0",
      resolution: "1920x1080",
      __csrf: "",
      channel: "netease",
      requestId: `${Date.now()}_${randomInt(0, 1000)}`,
    },
  };

  try {
    const res = await fetch(`${EAPI_DOMAIN}/eapi${path.slice(4)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Referer: "https://music.163.com",
        Cookie: `os=ios; osver=17.4.1; deviceId=${deviceId}; appver=9.0.90; versioncode=140; __csrf=${deviceId}`,
      },
      body: new URLSearchParams({ params: eapiParams(path, payload) }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};
