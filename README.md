# Taskbar Lyric · 任务栏歌词（独立版）

从 SPlayer-Next 抽取的 Windows 任务栏歌词独立应用。通过系统媒体控制（SMTC，
GlobalSystemMediaTransportControlsSessionManager）接入任意第三方播放器——
网易云音乐、QQ音乐、Spotify、浏览器等注册了 SMTC 会话的应用均可用。

## 功能

完整复刻 SPlayer 任务栏歌词的全部能力：

- **任务栏嵌入**：Win10 / Win11 双策略（UIA + SetParent），居中任务栏自动选侧，
  explorer.exe 重启自动重嵌，任务栏宽度/主题/托盘变化实时重算布局
- **逐字卡拉OK高亮**：渐变扫词 + 2px 渐变边缘，无逐字数据时自动降级逐行
- **双行显示**：主行歌词 + 副行（翻译优先，回退下一行），切行上下滑动动效
- **溢出滚动**：行文本超宽时按时间轴平滑向左滚动（前 30% 停留，结束前 2s 滚到底）
- **悬浮控件**：hover 展开上一首/播放暂停/下一首（透传到第三方播放器的 SMTC 控制命令）
- **悬浮歌曲信息**：hover 切换到歌名/歌手视图，双击打开设置
- **封面显示**：读取 SMTC 缩略图，按曲目落盘缓存（`smtc-cover://` 协议）
- **宽度自适应**：内容测宽上报 → `setShape` 裁切占用区，右锚定不随切行跳动
- **配色模式**：跟随任务栏 / 反色 / 浅色 / 深色，自动检测任务栏主题

歌词来源（SMTC 只有元数据，歌词由本应用匹配）：

1. 网易云音乐——按 标题+歌手 搜索，YRC 逐字 / LRC + 翻译
2. AMLL TTML DB——TTML 逐字覆盖（可在设置中关闭）
3. LRCLIB——同步 LRC 兜底

## 命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 构建 native(debug) + electron-vite dev
pnpm build            # 构建 native(release) + electron-vite build
pnpm typecheck        # tsc + vue-tsc
pnpm package:win      # 打包 Windows 安装包 / 便携版（dist/）
node scripts/build-native.mjs --force   # 强制重建原生模块
```

`SKIP_NATIVE_BUILD=true` 跳过 Rust 构建；已存在 `smtc-lyric.node` 时默认跳过（`--force` 重建）。

## 结构

```
electron/main/
├── index.ts               应用入口（单实例 / 托盘 / 协议注册）
├── store/                 settings.json 点路径读写（原子写）
├── window/taskbarLyric.ts 歌词窗口创建 + 任务栏嵌入 + 布局（移植自 SPlayer）
├── window/settings.ts     设置窗口
├── services/smtc.ts       SMTC 会话接入（事件 → Track/歌词/位置锚点）
├── services/nowPlaying.ts 播放状态广播（快照/位置同步）
├── services/lyrics/       网易云 weapi + TTML + LRCLIB + 匹配打分
├── services/coverProtocol.ts  smtc-cover:// 封面协议
└── ipc/                   config / dispatch / snapshot
native/smtc-lyric/         Rust 原生模块（NAPI-RS）
├── strategy/{win10,win11}.rs  任务栏空间布局策略（移植自 SPlayer）
├── uia_watcher / tray_watcher / registry_watcher / taskbar_created_watcher
└── smtc.rs                SMTC 会话订阅 + 封面抓取（WinRT）
windows/taskbar-lyric/     歌词窗口渲染端（App.vue / TaskbarLyricLine.vue 移植自 SPlayer）
windows/settings/          设置界面（复刻 taskbarLyric 设置项）
windows/shared/            useNowPlayingSync 播放同步 composable（移植自 SPlayer）
```

## 注意

- 仅支持 Windows 10/11（任务栏歌词与 SMTC 均为系统能力）
- 播放器必须注册 SMTC 会话；个别老版本 Win32 播放器不注册，属系统限制
- 逐字歌词依赖平台的 YRC/TTML 数据，命中 LRC 时自动降级为逐行显示
