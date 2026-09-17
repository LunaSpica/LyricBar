import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

/** 构建原生 smtc-lyric 模块（release 默认，--dev 走 debug） */

const isRustAvailable = () => {
  const result = spawnSync("cargo", ["--version"], { stdio: "ignore" });
  return !result.error && !result.signal && result.status === 0;
};

if (process.env.SKIP_NATIVE_BUILD === "true" || process.env.SKIP_NATIVE_BUILD === "1") {
  console.log("[BuildNative] SKIP_NATIVE_BUILD 已设置，跳过原生模块构建");
  process.exit(0);
}

if (!isRustAvailable()) {
  console.error("[BuildNative] 检测不到 Rust 工具链；设置 SKIP_NATIVE_BUILD=true 可跳过");
  process.exit(1);
}

const isDev = process.argv.includes("--dev");
const force = process.argv.includes("--force");
const crateDir = "native/smtc-lyric";
const outFile = `${crateDir}/smtc-lyric.node`;

if (existsSync(outFile) && !isDev && !force) {
  console.log("[BuildNative] 已存在 smtc-lyric.node，跳过（--force 强制重建）");
  process.exit(0);
}

const napiArgs = isDev ? ["build", "--no-const-enum"] : ["build", "--release", "--no-const-enum"];
console.log(`[BuildNative] npx napi ${napiArgs.join(" ")}（${crateDir}）`);

const result = spawnSync("npx", ["--no-install", "napi", ...napiArgs], {
  cwd: crateDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exitCode = result.status ?? 1;
