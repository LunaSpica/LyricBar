import type { LyricLine, LyricWord } from "../types/lyrics";

/**
 * 获取单个单词的纯文本内容（自动处理词尾空格）
 * @param word - 歌词单词节点
 * @returns 处理词尾空格后的单词文本
 */
export const getWordText = (word?: LyricWord | null): string => {
  if (!word) return "";
  return word.word + (word.endsWithSpace && !/\s$/.test(word.word) ? " " : "");
};

/**
 * 提取歌词行的纯文本内容（自动拼接所有单词并保留西文词间空格）
 * @param line - 歌词行数据
 * @returns 完整纯文本内容
 */
export const getLineText = (line?: LyricLine | null): string => {
  if (!line?.words || line.words.length === 0) return "";
  return line.words.map(getWordText).join("");
};
