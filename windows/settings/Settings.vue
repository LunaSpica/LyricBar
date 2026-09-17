<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import type { Settings, TaskbarLyricSettings, TaskbarLyricPosition, TaskbarLyricColorMode } from "@shared/types/settings";

/** 完整设置（本地镜像，变更即写回主进程） */
const settings = ref<Settings>({
  taskbarLyric: {
    position: "auto",
    autoMaxWidth: true,
    autoAdjustOccupiedSpace: false,
    maxWidth: 400,
    leftMargin: 0,
    rightMargin: 0,
    colorMode: "taskbar",
    showBackground: false,
    doubleLine: true,
    showTranslation: true,
    showCover: true,
    wordByWord: true,
    fontSize: 14,
    fontWeight: 400,
    fontFamily: "",
  },
  lyric: {
    enableOnlineTTMLLyric: true,
    amllDbServer: "https://amlldb.bikonoo.com/%p/%s.ttml",
  },
  lyricSources: ["netease", "ttml", "lrclib"],
});

const taskbarLyric = computed(() => settings.value.taskbarLyric);

/** 写回设置 */
const update = <K extends keyof TaskbarLyricSettings>(key: K, value: TaskbarLyricSettings[K]) => {
  settings.value.taskbarLyric[key] = value;
  window.api.config.set(`taskbarLyric.${key}`, value);
};

const updateLyric = <K extends keyof Settings["lyric"]>(key: K, value: Settings["lyric"][K]) => {
  settings.value.lyric[key] = value;
  window.api.config.set(`lyric.${key}`, value);
};

const POSITION_OPTIONS: Array<{ value: TaskbarLyricPosition; label: string }> = [
  { value: "auto", label: "自动（跟随任务栏对齐）" },
  { value: "left", label: "固定在左侧" },
  { value: "right", label: "固定在右侧" },
];

const COLOR_OPTIONS: Array<{ value: TaskbarLyricColorMode; label: string }> = [
  { value: "taskbar", label: "跟随任务栏" },
  { value: "taskbarInverse", label: "任务栏反色" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

onMounted(async () => {
  const saved = (await window.api.config.get("taskbarLyric")) as TaskbarLyricSettings | null;
  if (saved) settings.value.taskbarLyric = { ...settings.value.taskbarLyric, ...saved };
  const lyricCfg = (await window.api.config.get("lyric")) as Settings["lyric"] | null;
  if (lyricCfg) settings.value.lyric = { ...settings.value.lyric, ...lyricCfg };
});
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>任务栏歌词</h1>
      <p class="sub">通过系统媒体控制（SMTC）接入任意第三方播放器 · Beta</p>
    </header>

    <main class="scroll">
      <section class="section">
        <h2>位置与宽度</h2>

        <div class="item">
          <div class="label">显示位置</div>
          <select
            :value="taskbarLyric.position"
            @change="update('position', ($event.target as HTMLSelectElement).value as TaskbarLyricPosition)"
          >
            <option v-for="opt in POSITION_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="item">
          <div class="label-row">
            <span class="label">宽度自适应</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.autoMaxWidth }"
              @click="update('autoMaxWidth', !taskbarLyric.autoMaxWidth)"
            >
              <span class="knob" />
            </button>
          </div>
          <p class="desc">开启时占满可用空间，关闭时按最大宽度限制</p>
        </div>

        <div v-if="taskbarLyric.autoMaxWidth" class="item">
          <div class="label-row">
            <span class="label">动态调整占位</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.autoAdjustOccupiedSpace }"
              @click="update('autoAdjustOccupiedSpace', !taskbarLyric.autoAdjustOccupiedSpace)"
            >
              <span class="knob" />
            </button>
          </div>
          <p class="desc">根据当前歌词与悬浮控件动态调整真实窗口宽度</p>
        </div>

        <div v-else class="item">
          <div class="label">最大宽度 <em class="value">{{ taskbarLyric.maxWidth }}px</em></div>
          <input
            type="range"
            min="200"
            max="800"
            step="20"
            :value="taskbarLyric.maxWidth"
            @change="update('maxWidth', Number(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="item">
          <div class="label">左边距（像素）</div>
          <input
            type="number"
            min="0"
            max="500"
            :value="taskbarLyric.leftMargin"
            @change="update('leftMargin', Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))"
          />
        </div>

        <div class="item">
          <div class="label">右边距（像素）</div>
          <input
            type="number"
            min="0"
            max="500"
            :value="taskbarLyric.rightMargin"
            @change="update('rightMargin', Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))"
          />
        </div>
      </section>

      <section class="section">
        <h2>外观</h2>

        <div class="item">
          <div class="label">配色模式</div>
          <select
            :value="taskbarLyric.colorMode"
            @change="update('colorMode', ($event.target as HTMLSelectElement).value as TaskbarLyricColorMode)"
          >
            <option v-for="opt in COLOR_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="item">
          <div class="label-row">
            <span class="label">获得焦点时显示背景</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.showBackground }"
              @click="update('showBackground', !taskbarLyric.showBackground)"
            >
              <span class="knob" />
            </button>
          </div>
        </div>

        <div class="item">
          <div class="label">字号 <em class="value">{{ taskbarLyric.fontSize }}px</em></div>
          <input
            type="range"
            min="12"
            max="20"
            step="1"
            :value="taskbarLyric.fontSize"
            @input="update('fontSize', Number(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="item">
          <div class="label">字重 <em class="value">{{ taskbarLyric.fontWeight }}</em></div>
          <input
            type="range"
            min="100"
            max="900"
            step="100"
            :value="taskbarLyric.fontWeight"
            @input="update('fontWeight', Number(($event.target as HTMLInputElement).value))"
          />
        </div>

        <div class="item">
          <div class="label">字体</div>
          <input
            type="text"
            class="text-input"
            placeholder="留空使用默认字体栈"
            :value="taskbarLyric.fontFamily"
            @change="update('fontFamily', ($event.target as HTMLInputElement).value.trim())"
          />
        </div>
      </section>

      <section class="section">
        <h2>内容</h2>

        <div class="item">
          <div class="label-row">
            <span class="label">显示封面</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.showCover }"
              @click="update('showCover', !taskbarLyric.showCover)"
            >
              <span class="knob" />
            </button>
          </div>
        </div>

        <div class="item">
          <div class="label-row">
            <span class="label">逐字高亮</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.wordByWord }"
              @click="update('wordByWord', !taskbarLyric.wordByWord)"
            >
              <span class="knob" />
            </button>
          </div>
          <p class="desc">逐字歌词不可用时自动降级为逐行显示</p>
        </div>

        <div class="item">
          <div class="label-row">
            <span class="label">双行显示</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.doubleLine }"
              @click="update('doubleLine', !taskbarLyric.doubleLine)"
            >
              <span class="knob" />
            </button>
          </div>
        </div>

        <div v-if="taskbarLyric.doubleLine" class="item">
          <div class="label-row">
            <span class="label">显示翻译</span>
            <button
              class="switch"
              :class="{ on: taskbarLyric.showTranslation }"
              @click="update('showTranslation', !taskbarLyric.showTranslation)"
            >
              <span class="knob" />
            </button>
          </div>
          <p class="desc">副行优先显示翻译，没有翻译时回退显示下一行</p>
        </div>
      </section>

      <section class="section">
        <h2>歌词源</h2>

        <div class="item">
          <div class="label-row">
            <span class="label">AMLL TTML 逐字歌词</span>
            <button
              class="switch"
              :class="{ on: settings.lyric.enableOnlineTTMLLyric }"
              @click="updateLyric('enableOnlineTTMLLyric', !settings.lyric.enableOnlineTTMLLyric)"
            >
              <span class="knob" />
            </button>
          </div>
          <p class="desc">网易云命中歌词后，尝试用 AMLL TTML DB 的逐字时间轴覆盖</p>
        </div>
      </section>

      <p class="footer">
        歌词来源：网易云音乐（YRC 逐字 / LRC + 翻译）→ AMLL TTML DB → LRCLIB。
        播放控制与封面读取通过 SMTC 对接当前活跃的媒体会话。
      </p>
    </main>
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f6f6f8;
  color: #1a1a1a;
}
.header {
  padding: 20px 24px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.header h1 {
  font-size: 18px;
  font-weight: 600;
}
.sub {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  margin-top: 4px;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px 24px;
}
.section {
  margin-bottom: 20px;
}
.section h2 {
  font-size: 12px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.item {
  padding: 10px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}
.label {
  font-size: 14px;
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.desc {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  margin-top: 4px;
}
.value {
  font-style: normal;
  color: rgba(0, 0, 0, 0.45);
  margin-left: 6px;
}
select,
.text-input,
input[type="number"] {
  margin-top: 6px;
  width: 100%;
  max-width: 260px;
  padding: 6px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  color: inherit;
  outline: none;
}
input[type="range"] {
  margin-top: 8px;
  width: 100%;
  max-width: 260px;
  accent-color: #fa6863;
}
.switch {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: rgba(0, 0, 0, 0.16);
  cursor: pointer;
  transition: background 0.25s;
}
.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.switch.on {
  background: #fa6863;
}
.switch.on .knob {
  left: 20px;
}
.footer {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.4);
  line-height: 1.6;
}
</style>
