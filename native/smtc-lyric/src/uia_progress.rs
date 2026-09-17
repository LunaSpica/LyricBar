//! 网易云主窗口播放进度读取（UIA 轮询）
//!
//! cloudmusic.exe 不维护 SMTC 时间轴：Position/LastUpdatedTime 恒为零值，seek 完全
//! 不可见。提供两条兜底通道：
//! 1. 进度滑杆：底部栏进度条是 RangeValue 元素（Value=当前秒、Maximum=总秒），
//!    亚秒精度；但其 a11y 语义只在进度条被交互（点击/拖动）后暴露，且随网易云
//!    布局变化时有时无。
//! 2. 播放页歌词行：当前行垂直居中于歌词区，a11y 文本始终可读且带真实矩形——
//!    取视口中位行的文本变化作为行级真值（粒度 = 行时长）。
//! 两者都不可用时退回 SMTC 内部计时器。

use std::time::{Duration, Instant};

use windows::Win32::{
    System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance},
    UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
        IUIAutomationRangeValuePattern, TreeScope_Children, TreeScope_Descendants,
        UIA_RangeValuePatternId,
    },
};
use windows::core::Interface;

use crate::utils::process_image_name;

/// 无候选时的全量重扫间隔：控制窗口缺失/滑杆缺失期间的扫描成本
const DISCOVER_BACKOFF: Duration = Duration::from_secs(2);
/// 视为读数变化的阈值：滑杆值以亚秒步进更新，暂停时完全冻结
const VALUE_EPSILON: f64 = 0.05;
/// 歌词行兜底通道的轮询间隔（行变化粒度秒级，无需更快）
const LYRIC_LINE_INTERVAL: Duration = Duration::from_millis(1200);

pub struct ProgressReader {
    automation: IUIAutomation,
    cond: Option<IUIAutomationCondition>,
    /// 缓存的滑杆元素（值读取只需一次跨进程属性调用）；失效后重扫
    cached_slider: Option<IUIAutomationElement>,
    /// 缓存的主窗口元素：Name 即窗口标题「歌曲 - 歌手」，网易云不广播
    /// SMTC 元数据切歌时（歌单播完自动切换）靠它兜底感知切歌
    cached_window: Option<IUIAutomationElement>,
    last_value: f64,
    last_max: f64,
    has_emitted: bool,
    last_title: String,
    last_line_text: String,
    /// 无候选期间的下一次全量扫描时间
    next_discover: Instant,
    /// 歌词行兜底通道的下一次轮询时间
    next_line_poll: Instant,
}

/// 一次轮询的产出：滑杆读数 / 窗口标题 / 当前歌词行，任一变化时出现
pub struct ProgressSample {
    /// 滑杆读数变化：(位置毫秒, 总时长毫秒)
    pub position: Option<(i64, i64)>,
    /// 窗口标题变化（「歌曲 - 歌手」）
    pub title: Option<String>,
    /// 播放页当前歌词行文本变化
    pub line: Option<String>,
}

impl ProgressReader {
    /// 创建 UIA 客户端。调用线程必须已完成 COM 初始化（SMTC worker 线程满足）
    pub fn new() -> windows::core::Result<Self> {
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)? };
        let cond = unsafe { automation.CreateTrueCondition().ok() };
        Ok(Self {
            automation,
            cond,
            cached_slider: None,
            cached_window: None,
            last_value: 0.0,
            last_max: 0.0,
            has_emitted: false,
            last_title: String::new(),
            last_line_text: String::new(),
            next_discover: Instant::now(),
            next_line_poll: Instant::now(),
        })
    }

    /// 轮询一次。滑杆通道优先；不可用时以播放页歌词行兜底
    pub fn poll(&mut self) -> Option<ProgressSample> {
        let mut sample = ProgressSample {
            position: None,
            title: None,
            line: None,
        };

        if self.cached_slider.is_some() {
            // 滑杆通道：读数 + 标题
            if let Some(slider) = self.cached_slider.take() {
                match read_slider(&slider) {
                    Ok((value, max)) => {
                        self.cached_slider = Some(slider);
                        sample.position = self.consume_position(value, max);
                    }
                    Err(_) => {} // 元素失效（窗口关闭/树重建），走重扫
                }
            }
            sample.title = self.poll_title();
        } else if self.cached_window.is_some() && Instant::now() >= self.next_line_poll {
            // 滑杆缺失：歌词行兜底
            self.next_line_poll = Instant::now() + LYRIC_LINE_INTERVAL;
            sample.line = self.poll_lyric_line();
        }

        // 滑杆缺失时按节奏重扫，恢复缓存
        if self.cached_slider.is_none() && Instant::now() >= self.next_discover {
            self.next_discover = Instant::now() + DISCOVER_BACKOFF;
            if let Some((found, window)) = self.discover() {
                self.cached_window = Some(window);
                if let Some((value, max)) = found {
                    sample.position = self.consume_position(value, max);
                }
            }
        }

        if sample.position.is_none() && sample.title.is_none() && sample.line.is_none() {
            return None;
        }
        Some(sample)
    }

    /// 滑杆读数变化判定与单位换算
    fn consume_position(&mut self, value: f64, max: f64) -> Option<(i64, i64)> {
        let changed = !self.has_emitted
            || (value - self.last_value).abs() > VALUE_EPSILON
            || (max - self.last_max).abs() > VALUE_EPSILON;
        self.last_value = value;
        self.last_max = max;
        self.has_emitted = true;
        if changed {
            Some(((value * 1000.0) as i64, (max * 1000.0) as i64))
        } else {
            None
        }
    }

    /// 读取窗口标题，变化时返回新标题
    fn poll_title(&mut self) -> Option<String> {
        let window = self.cached_window.as_ref()?;
        let title = unsafe { window.CurrentName().ok() }?.to_string();
        if !title.is_empty() && title != self.last_title {
            self.last_title = title.clone();
            return Some(title);
        }
        None
    }

    /// 读取播放页歌词区垂直中位的文本行（网易云把当前行居中），变化时返回
    fn poll_lyric_line(&mut self) -> Option<String> {
        let Some(cond) = self.cond.as_ref() else {
            return None;
        };
        let window = self.cached_window.as_ref()?;
        let win_rect = unsafe { window.CurrentBoundingRectangle() }.ok()?;
        let win_left = win_rect.left as f64;
        let win_top = win_rect.top as f64;
        let win_w = (win_rect.right - win_rect.left) as f64;
        let win_h = (win_rect.bottom - win_rect.top) as f64;
        if win_w <= 0.0 || win_h <= 0.0 {
            return None;
        }

        let all = unsafe { window.FindAll(TreeScope_Descendants, cond) }.ok()?;
        let count = unsafe { all.Length().unwrap_or(0) };
        let mut rows: Vec<(i32, String)> = Vec::new();
        for j in 0..count {
            let item = unsafe { all.GetElement(j) };
            let Ok(item) = item else {
                continue;
            };
            let name = unsafe { item.CurrentName() };
            let Ok(name) = name else {
                continue;
            };
            let name = name.to_string();
            if name.trim().is_empty() || name.chars().count() > 100 {
                continue;
            }
            let rect = unsafe { item.CurrentBoundingRectangle() };
            let Ok(rect) = rect else {
                continue;
            };
            if rect.right <= rect.left || rect.bottom <= rect.top {
                continue;
            }
            let cx = (rect.left + rect.right) as f64 / 2.0;
            let cy = (rect.top + rect.bottom) as f64 / 2.0;
            // 歌词区：窗口右半、垂直 30%~92%（排除标题/页签/底栏/左侧黑胶）
            if cx < win_left + win_w * 0.45 {
                continue;
            }
            if cy < win_top + win_h * 0.3 || cy > win_top + win_h * 0.92 {
                continue;
            }
            rows.push((rect.top, name));
        }
        if rows.is_empty() {
            return None;
        }
        rows.sort_by_key(|(top, _)| *top);
        let text = rows[(rows.len() - 1) / 2].1.clone();
        if text != self.last_line_text {
            self.last_line_text = text.clone();
            return Some(text);
        }
        None
    }

    /// 全量扫描网易云顶层窗口，找出进度滑杆与主窗口元素
    fn discover(&mut self) -> Option<(Option<(f64, f64)>, IUIAutomationElement)> {
        let Some(cond) = self.cond.as_ref() else {
            return None;
        };
        let root = unsafe { self.automation.GetRootElement() }.ok()?;
        let tops = unsafe { root.FindAll(TreeScope_Children, cond) }.ok()?;
        let count = unsafe { tops.Length().unwrap_or(0) };

        for i in 0..count {
            let top = unsafe { tops.GetElement(i) };
            let Ok(top) = top else { continue };
            let pid = unsafe { top.CurrentProcessId() };
            let Ok(pid) = pid else { continue };
            if process_image_name(pid as u32).is_none_or(|p| !p.ends_with("\\cloudmusic.exe")) {
                continue;
            }
            let hwnd = unsafe { top.CurrentNativeWindowHandle() };
            let Ok(hwnd) = hwnd else { continue };
            let el_res = unsafe { self.automation.ElementFromHandle(hwnd) };
            let Ok(el) = el_res else { continue };
            let descs_res = unsafe { el.FindAll(TreeScope_Descendants, cond) };
            let Ok(descs) = descs_res else { continue };
            let desc_count = unsafe { descs.Length().unwrap_or(0) };

            let mut slider: Option<(f64, f64)> = None;
            for j in 0..desc_count {
                let item = unsafe { descs.GetElement(j) };
                let Ok(item) = item else { continue };
                let Some((value, max)) = read_slider(&item).ok() else {
                    continue;
                };
                if max <= 0.0 || value < 0.0 {
                    continue;
                }
                slider = Some((value, max));
                break;
            }
            self.cached_window = Some(el.clone());
            if let Some((value, max)) = slider {
                return Some((Some((value, max)), el));
            }
            // 本窗口无滑杆（如播放页布局），窗口元素仍供标题/歌词行通道使用
            return Some((None, el));
        }
        None
    }
}

/// 读取滑杆的当前值与最大值；无 RangeValue 模式的元素返回 Err
fn read_slider(el: &IUIAutomationElement) -> windows::core::Result<(f64, f64)> {
    unsafe {
        let unknown = el.GetCurrentPattern(UIA_RangeValuePatternId)?;
        let pattern = unknown.cast::<IUIAutomationRangeValuePattern>()?;
        Ok((pattern.CurrentValue()?, pattern.CurrentMaximum()?))
    }
}
