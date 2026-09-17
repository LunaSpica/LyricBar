//! SMTC（System Media Transport Controls）会话读取
//!
//! 订阅系统全部媒体会话，按「正在播放优先 + 最近活跃」选出当前会话，
//! 把媒体元数据 / 播放状态 / 时间轴以 JSON 事件推给 JS。
//! 封面通过 Thumbnail 流直接写入 JS 指定的缓存目录。
//!
//! 线程模型：所有 WinRT 事件回调（任意线程）只投递 Evaluate 命令，
//! worker 线程去抖后统一访问 WinRT 对象并发出事件。

use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

use napi::Status;
use napi::bindgen_prelude::Function;
use napi::threadsafe_function::{
    ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue,
};
use napi_derive::napi;
use windows::Foundation::{DateTime, TimeSpan, TypedEventHandler};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStream};
use windows::core::Interface;

use crate::uia_progress::ProgressReader;
use crate::utils::ComApartmentGuard;

/// 事件回调去抖窗口：切歌时 Metadata/Playback/Timeline 连发，合并为一轮评估
const DEBOUNCE_MS: u64 = 60;
/// UIA 进度轮询周期：seek 感知延迟的上界
const UIA_POLL_INTERVAL: Duration = Duration::from_millis(400);

enum Command {
    /// 任一 WinRT 事件触发重评估
    Evaluate,
    /// 封面文件已落盘
    CoverReady(String),
    Control(SmtcAction),
    Stop,
}

enum SmtcAction {
    Play,
    Pause,
    Next,
    Prev,
}

type EventTsfn = ThreadsafeFunction<String, UnknownReturnValue, String, Status, false>;

/// FILETIME（1601 起 100ns）→ Unix 毫秒
const FILETIME_UNIX_DELTA_MS: i64 = 11_644_736_000_000;

fn datetime_to_unix_ms(dt: DateTime) -> i64 {
    dt.UniversalTime / 10_000 - FILETIME_UNIX_DELTA_MS
}

fn timespan_to_ms(ts: TimeSpan) -> i64 {
    ts.Duration / 10_000
}

fn status_to_str(status: GlobalSystemMediaTransportControlsSessionPlaybackStatus) -> &'static str {
    match status {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "playing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "paused",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "stopped",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed => "closed",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => "changing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened => "opened",
        _ => "unknown",
    }
}

#[derive(Debug, Clone)]
struct SessionSnapshot {
    source: String,
    title: String,
    artist: String,
    album: String,
    status: String,
    position_ms: i64,
    last_updated_ms: i64,
    duration_ms: i64,
}

impl SessionSnapshot {
    fn from_session(session: &GlobalSystemMediaTransportControlsSession) -> Option<Self> {
        let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let playback = session.GetPlaybackInfo().ok()?;
        let timeline = session.GetTimelineProperties().ok()?;

        let text = |s: windows::core::Result<windows::core::HSTRING>| -> String {
            s.map(|v| v.to_string()).unwrap_or_default()
        };

        Some(Self {
            source: text(session.SourceAppUserModelId()),
            title: text(props.Title()),
            artist: text(props.Artist()),
            album: text(props.AlbumTitle()),
            status: playback
                .PlaybackStatus()
                .map(status_to_str)
                .unwrap_or("unknown")
                .to_string(),
            position_ms: timespan_to_ms(timeline.Position().unwrap_or_default()),
            last_updated_ms: datetime_to_unix_ms(timeline.LastUpdatedTime().unwrap_or_default()),
            duration_ms: timespan_to_ms(timeline.EndTime().unwrap_or_default()),
        })
    }

    /// 会话是否值得参与选择：有标题或有歌手（过滤系统空会话）
    fn meaningful(&self) -> bool {
        !self.title.trim().is_empty() || !self.artist.trim().is_empty()
    }

    fn playing(&self) -> bool {
        self.status == "playing"
    }

    /// 封面缓存 key：同一曲目复用落盘文件
    fn cover_key(&self) -> String {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for part in [&self.source, &self.title, &self.artist, &self.album] {
            for b in part.as_bytes() {
                h ^= *b as u64;
                h = h.wrapping_mul(0x100_0000_01b3);
            }
            h ^= 0xff;
            h = h.wrapping_mul(0x100_0000_01b3);
        }
        format!("{h:016x}")
    }

    fn to_json(&self, cover_key: Option<&str>) -> serde_json::Value {
        serde_json::json!({
            "type": "snapshot",
            "source": self.source,
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "status": self.status,
            "positionMs": self.position_ms,
            "lastUpdatedMs": self.last_updated_ms,
            "durationMs": self.duration_ms,
            "coverKey": cover_key,
        })
    }
}

/// 去重发出：内容与上次相同则跳过
fn emit(tsfn: &EventTsfn, last: &mut String, value: serde_json::Value) {
    let json = value.to_string();
    if *last == json {
        return;
    }
    *last = json.clone();
    tsfn.call(json, ThreadsafeFunctionCallMode::NonBlocking);
}

#[napi(js_name = "SmtcWatcher")]
pub struct NapiSmtcWatcher {
    sender: Sender<Command>,
}

#[napi]
impl NapiSmtcWatcher {
    #[napi(
        constructor,
        ts_args_type = "saveDir: string, lastSource: string, callback: (json: string) => void"
    )]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        save_dir: String,
        last_source: String,
        callback: Function<String, UnknownReturnValue>,
    ) -> napi::Result<Self> {
        let tsfn = callback
            .build_threadsafe_function::<String>()
            .build_callback(|ctx| Ok(ctx.value))?;

        let (tx, rx) = mpsc::channel::<Command>();
        let sender = tx.clone();

        thread::spawn(move || {
            if worker_loop(save_dir, last_source, rx, tx, tsfn).is_err() {
                error!("SMTC worker 异常退出");
            }
        });

        Ok(Self { sender })
    }

    /// 向当前会话发送控制命令：play | pause | next | prev
    #[napi]
    pub fn control(&self, action: String) {
        let action = match action.as_str() {
            "play" => SmtcAction::Play,
            "pause" => SmtcAction::Pause,
            "next" => SmtcAction::Next,
            "prev" => SmtcAction::Prev,
            _ => return,
        };
        let _ = self.sender.send(Command::Control(action));
    }

    #[napi]
    pub fn stop(&self) {
        let _ = self.sender.send(Command::Stop);
    }
}

struct WorkerState {
    /// 已注册事件回调的会话：source → (session, [tokens; 3])
    registered: HashMap<String, (GlobalSystemMediaTransportControlsSession, [i64; 3])>,
    current_source: String,
    last_emit: String,
    last_uia_emit: String,
    last_cover_key: String,
    /// 当前选中会话的 SMTC 时间轴是否可用；不可用且为网易云时启用 UIA 进度轮询
    timeline_alive: bool,
}

fn worker_loop(
    save_dir: String,
    last_source: String,
    rx: mpsc::Receiver<Command>,
    event_tx: Sender<Command>,
    tsfn: EventTsfn,
) -> anyhow::Result<()> {
    let Some(_com_guard) = ComApartmentGuard::try_init() else {
        error!("SMTC worker 初始化 COM 失败");
        return Ok(());
    };

    let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
        Ok(op) => match op.join() {
            Ok(m) => m,
            Err(_err) => {
                error!("获取 SMTC 管理器失败: {err}");
                return Ok(());
            }
        },
        Err(_err) => {
            error!("发起 SMTC RequestAsync 失败: {err}");
            return Ok(());
        }
    };

    let manager_token = manager
        .SessionsChanged(&TypedEventHandler::new({
            let tx = event_tx.clone();
            move |_, _| {
                let _ = tx.send(Command::Evaluate);
                Ok(())
            }
        }))
        .ok();

    // UIA 客户端建在 worker 线程上（COM apartment 已就绪）；创建失败则退化为纯 SMTC
    let mut progress_reader = ProgressReader::new().ok();

    let mut state = WorkerState {
        registered: HashMap::new(),
        current_source: last_source,
        last_emit: String::new(),
        last_uia_emit: String::new(),
        last_cover_key: String::new(),
        timeline_alive: false,
    };

    // SessionsChanged 只在会话列表变化时触发；watcher 启动前已存在的会话
    // （如已在播放的播放器）不会推送事件，必须主动做一次首轮评估
    let _ = event_tx.send(Command::Evaluate);

    loop {
        match rx.recv_timeout(UIA_POLL_INTERVAL) {
            Ok(first) => {
                let mut batch = vec![first];
                while let Ok(m) = rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    batch.push(m);
                }

                if batch.iter().any(|c| matches!(c, Command::Stop)) {
                    cleanup(&manager, &manager_token, &mut state);
                    return Ok(());
                }

                for cmd in batch {
                    match cmd {
                        Command::Control(action) => dispatch_control(&manager, &action),
                        Command::CoverReady(key) => emit(
                            &tsfn,
                            &mut state.last_emit,
                            serde_json::json!({ "type": "cover", "key": key }),
                        ),
                        _ => {}
                    }
                }
                evaluate(&manager, &save_dir, &mut state, &tsfn, &event_tx);
            }
            Err(RecvTimeoutError::Timeout) => {
                poll_uia_progress(&mut state, progress_reader.as_mut(), &tsfn);
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    cleanup(&manager, &manager_token, &mut state);
    Ok(())
}

/// 无时间轴的网易云会话：轮询主窗口进度滑杆，读数变化时补发 uiaPosition 事件
fn poll_uia_progress(
    state: &mut WorkerState,
    reader: Option<&mut ProgressReader>,
    tsfn: &EventTsfn,
) {
    let Some(reader) = reader else { return };
    if state.timeline_alive
        || state.current_source.trim().is_empty()
        || !state.current_source.ends_with("cloudmusic.exe")
    {
        return;
    }
    let Some(sample) = reader.poll() else { return };
    if let Some((pos_ms, duration_ms)) = sample.position {
        emit(
            tsfn,
            &mut state.last_uia_emit,
            serde_json::json!({
                "type": "uiaPosition",
                "posMs": pos_ms,
                "durationMs": duration_ms,
            }),
        );
    }
    if let Some(title) = sample.title {
        emit(
            tsfn,
            &mut state.last_uia_emit,
            serde_json::json!({
                "type": "uiaTrack",
                "title": title,
            }),
        );
    }
    if let Some(line) = sample.line {
        emit(
            tsfn,
            &mut state.last_uia_emit,
            serde_json::json!({
                "type": "uiaLine",
                "text": line,
            }),
        );
    }
}

fn dispatch_control(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    action: &SmtcAction,
) {
    let Some(session) = select_session(manager) else {
        warn!("无可用媒体会话，控制命令被忽略");
        return;
    };
    let result = match action {
        SmtcAction::Play => session.TryPlayAsync(),
        SmtcAction::Pause => session.TryPauseAsync(),
        SmtcAction::Next => session.TrySkipNextAsync(),
        SmtcAction::Prev => session.TrySkipPreviousAsync(),
    };
    if let Ok(op) = result {
        let _ = op.join();
    }
}

/// 按「正在播放优先 + 最近活跃」选会话；无候选时返回 None
fn select_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Option<GlobalSystemMediaTransportControlsSession> {
    let sessions = manager.GetSessions().ok()?;
    let count = sessions.Size().ok()?;

    let mut best_playing: Option<(i64, GlobalSystemMediaTransportControlsSession)> = None;
    let mut best_any: Option<(i64, GlobalSystemMediaTransportControlsSession)> = None;
    for i in 0..count {
        let Ok(session) = sessions.GetAt(i) else {
            continue;
        };
        let Some(snap) = SessionSnapshot::from_session(&session) else {
            continue;
        };
        if !snap.meaningful() {
            continue;
        }
        if snap.playing() {
            match &best_playing {
                Some((t, _)) if *t >= snap.last_updated_ms => {}
                _ => best_playing = Some((snap.last_updated_ms, session.clone())),
            }
        }
        match &best_any {
            Some((t, _)) if *t >= snap.last_updated_ms => {}
            _ => best_any = Some((snap.last_updated_ms, session)),
        }
    }
    best_playing.or(best_any).map(|(_, s)| s)
}

/// 一轮评估：同步会话事件注册 → 选会话 → 发快照 → 按需抓封面
fn evaluate(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    save_dir: &str,
    state: &mut WorkerState,
    tsfn: &EventTsfn,
    event_tx: &Sender<Command>,
) {
    let Ok(sessions) = manager.GetSessions() else {
        return;
    };
    let Ok(count) = sessions.Size() else { return };

    let mut items: Vec<(GlobalSystemMediaTransportControlsSession, SessionSnapshot)> = Vec::new();
    for i in 0..count {
        let Ok(session) = sessions.GetAt(i) else {
            continue;
        };
        let Some(snap) = SessionSnapshot::from_session(&session) else {
            continue;
        };
        if snap.source.trim().is_empty() {
            continue;
        }
        items.push((session, snap));
    }

    let alive: HashSet<String> = items.iter().map(|(_, s)| s.source.clone()).collect();

    for source in state.registered.keys().cloned().collect::<Vec<_>>() {
        if alive.contains(&source) {
            continue;
        }
        let Some((session, tokens)) = state.registered.remove(&source) else {
            continue;
        };
        let _ = session.RemoveMediaPropertiesChanged(tokens[0]);
        let _ = session.RemovePlaybackInfoChanged(tokens[1]);
        let _ = session.RemoveTimelinePropertiesChanged(tokens[2]);
    }

    for (session, snap) in &items {
        if state.registered.contains_key(&snap.source) {
            continue;
        }
        let t1 = session.MediaPropertiesChanged(&TypedEventHandler::new({
            let tx = event_tx.clone();
            move |_, _| {
                let _ = tx.send(Command::Evaluate);
                Ok(())
            }
        }));
        let t2 = session.PlaybackInfoChanged(&TypedEventHandler::new({
            let tx = event_tx.clone();
            move |_, _| {
                let _ = tx.send(Command::Evaluate);
                Ok(())
            }
        }));
        let t3 = session.TimelinePropertiesChanged(&TypedEventHandler::new({
            let tx = event_tx.clone();
            move |_, _| {
                let _ = tx.send(Command::Evaluate);
                Ok(())
            }
        }));
        if let (Ok(a), Ok(b), Ok(c)) = (t1, t2, t3) {
            state
                .registered
                .insert(snap.source.clone(), (session.clone(), [a, b, c]));
        } else {
            warn!("注册会话事件失败: {}", snap.source);
        }
    }

    let candidates: Vec<&(GlobalSystemMediaTransportControlsSession, SessionSnapshot)> =
        items.iter().filter(|(_, s)| s.meaningful()).collect();
    let any_playing = candidates.iter().any(|(_, s)| s.playing());
    // 粘性选择：当前会话仍在播（或没有任何会话在播）时保持不动。
    // 否则网易云暂停（时间轴缺失 → lastUpdatedMs 为极小值）会被其他
    // lastUpdated 更新的暂停会话抢走，歌词窗口瞬间切换到无关曲目
    let selected = candidates
        .iter()
        .find(|(_, s)| s.source == state.current_source)
        .filter(|(_, s)| s.playing() || !any_playing)
        .or_else(|| {
            candidates
                .iter()
                .filter(|(_, s)| s.playing())
                .max_by_key(|(_, s)| s.last_updated_ms)
        })
        .or_else(|| candidates.iter().max_by_key(|(_, s)| s.last_updated_ms))
        .copied();

    let Some((session, snap)) = selected else {
        if !state.current_source.is_empty() {
            state.current_source.clear();
            state.last_cover_key.clear();
            state.timeline_alive = false;
            emit(
                &tsfn,
                &mut state.last_emit,
                serde_json::json!({ "type": "none" }),
            );
        }
        return;
    };

    let key = snap.cover_key();
    state.current_source = snap.source.clone();
    state.timeline_alive = snap.last_updated_ms > 0;

    emit(&tsfn, &mut state.last_emit, snap.to_json(Some(&key)));

    let cover_file = std::path::Path::new(save_dir).join(format!("{key}.img"));
    if state.last_cover_key != key {
        state.last_cover_key = key.clone();
        if cover_file.exists() {
            let _ = event_tx.send(Command::CoverReady(key));
        } else {
            spawn_cover_task(&session, key, save_dir.to_string(), event_tx.clone());
        }
    }
}

fn spawn_cover_task(
    session: &GlobalSystemMediaTransportControlsSession,
    key: String,
    save_dir: String,
    event_tx: Sender<Command>,
) {
    let session = session.clone();
    thread::spawn(
        move || match fetch_and_save_cover(&session, &save_dir, &key) {
            Ok(()) => {
                let _ = event_tx.send(Command::CoverReady(key));
            }
            Err(_err) => {
                warn!("抓取封面失败: {err}");
            }
        },
    );
}

fn fetch_and_save_cover(
    session: &GlobalSystemMediaTransportControlsSession,
    save_dir: &str,
    key: &str,
) -> anyhow::Result<()> {
    let props = session.TryGetMediaPropertiesAsync()?.join()?;
    let thumb = props.Thumbnail()?;
    let stream = thumb.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    if size == 0 {
        anyhow::bail!("封面流为空");
    }
    let base: IRandomAccessStream = stream.cast()?;
    let reader = DataReader::CreateDataReader(&base)?;
    let loaded = reader.LoadAsync(size as u32)?.join()? as usize;
    if loaded == 0 {
        anyhow::bail!("封面内容为空");
    }
    let mut buf = vec![0u8; loaded];
    reader.ReadBytes(&mut buf)?;

    std::fs::create_dir_all(save_dir)?;
    let path = std::path::Path::new(save_dir).join(format!("{key}.img"));
    let tmp = std::path::Path::new(save_dir).join(format!("{key}.img.tmp"));
    std::fs::write(&tmp, &buf)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// 停止时注销全部事件回调，避免残留引用
fn cleanup(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
    manager_token: &Option<i64>,
    state: &mut WorkerState,
) {
    for (_source, (session, tokens)) in state.registered.drain() {
        let _ = session.RemoveMediaPropertiesChanged(tokens[0]);
        let _ = session.RemovePlaybackInfoChanged(tokens[1]);
        let _ = session.RemoveTimelinePropertiesChanged(tokens[2]);
        debug!("注销会话事件: {source}");
    }
    if let Some(token) = manager_token {
        let _ = manager.RemoveSessionsChanged(*token);
    }
}
