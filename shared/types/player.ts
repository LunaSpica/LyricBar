/** 歌手 */
export interface Artist {
  name: string;
}

/** 专辑 */
export interface Album {
  name: string;
}

/** 歌词渲染引擎支持的完整播放状态 */
export type PlayerState = "idle" | "loading" | "playing" | "paused" | "stopped";

/** 当前曲目（队列轻量数据，不含歌词等重内容） */
export interface Track {
  /** 稳定标识：由 SMTC source + title + artist 摘要生成 */
  id: string;
  title: string;
  artists: Artist[];
  album?: Album;
  /** 毫秒 */
  duration: number;
  /** 封面 URL（smtc-cover:// 协议或外链） */
  cover?: string | null;
}
