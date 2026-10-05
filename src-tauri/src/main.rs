//! Soundwavian Field - Windows host.
//!
//! One conventional executable, shipped twice by the installer under stable
//! names: `SoundwavianField.exe` (the app) and `SoundwavianField.scr` (the
//! screen saver entry point), built from the same compiled binary. It renders a
//! locally bundled WebGL page in the system WebView2 runtime.
//!
//! Process model: this process plus the WebView2 runtime's own helper
//! processes. No services, scheduled tasks, startup entries, background
//! processes, network requests, updaters or telemetry. Everything ends
//! when the window closes.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mode;
mod settings;
#[cfg(windows)]
mod win;

use mode::Mode;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Chromium switches for the embedded WebView2: keep the defaults wry uses
/// (SmartScreen / out-of-process UI off - there is no web content to vet,
/// only local files) and switch off every background network service.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--disable-background-networking --disable-component-update --disable-domain-reliability \
--disable-sync --no-pings --disable-breakpad";

const SCR_NAME: &str = "SoundwavianField.scr";

/// Exit code when the screen saver ends because another application took
/// the foreground (0 = dismissed by input). Windows ignores screen saver
/// exit codes; this only makes the two paths distinguishable in tests.
#[cfg(windows)]
const EXIT_FOCUS_LOST: i32 = 2;

/// Longest a dismissed program may take to shut down cleanly before the
/// watchdog ends the process.
const EXIT_GRACE: Duration = Duration::from_millis(1000);

static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static WINDOW_HANDLES: std::sync::Mutex<Vec<isize>> = std::sync::Mutex::new(Vec::new());

static MODE: OnceLock<Mode> = OnceLock::new();
static HAD_FOCUS: AtomicBool = AtomicBool::new(false);

/// Opt-in diagnostics for the release test. Only when the `SFIELD_TRACE`
/// environment variable names a file are input-watcher and shutdown events
/// appended to it (wall-clock milliseconds + message). Otherwise nothing is
/// written anywhere.
fn trace(msg: std::fmt::Arguments) {
    static SINK: OnceLock<Option<std::sync::Mutex<std::fs::File>>> = OnceLock::new();
    let sink = SINK.get_or_init(|| {
        let path = std::env::var_os("SFIELD_TRACE")?;
        let file = std::fs::OpenOptions::new().create(true).append(true).open(path).ok()?;
        Some(std::sync::Mutex::new(file))
    });
    if let Some(Ok(mut file)) = sink.as_ref().map(|f| f.lock()) {
        use std::io::Write;
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(file, "{ms} {msg}");
    }
}

macro_rules! trace {
    ($($t:tt)*) => { trace(format_args!($($t)*)) };
}

fn invoked_as_scr() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.extension().map(|e| e.eq_ignore_ascii_case("scr")))
        .unwrap_or(false)
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

// ---- commands (the complete IPC surface exposed to the page) -------------

#[tauri::command]
fn load_settings(app: AppHandle) -> Option<String> {
    settings::load(&config_dir(&app).ok()?)
}

#[tauri::command]
fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    settings::save(&config_dir(&app)?, &json)
}

/// The watchdog thread is started with the program, long before any input,
/// and parked on a channel. Creating a thread at shutdown time was not
/// reliable: in testing, the first keystroke into the WebView2 window kept
/// the UI thread loading input DLLs (under the loader lock, which every new
/// thread needs) for seconds, so a watchdog spawned then started late or
/// not at all. Waking a parked thread needs no lock of that kind.
static WATCHDOG: OnceLock<std::sync::mpsc::Sender<(Duration, i32)>> = OnceLock::new();

fn start_watchdog() {
    let (tx, rx) = std::sync::mpsc::channel::<(Duration, i32)>();
    std::thread::spawn(move || {
        if let Ok((grace, code)) = rx.recv() {
            std::thread::sleep(grace);
            trace!("watchdog: terminating");
            #[cfg(windows)]
            win::terminate_now(code);
            #[cfg(not(windows))]
            std::process::exit(code);
        }
    });
    let _ = WATCHDOG.set(tx);
}

/// Ends the program. Order matters, and every step is non-blocking:
///  1. Only the first caller proceeds (input can be detected by the page and
///     by the native watcher at the same moment).
///  2. The pre-started watchdog is triggered before anything else. As a
///     screen saver there is nothing to save, so the process is terminated
///     at once; other modes get `EXIT_GRACE` to close normally. Termination
///     skips CRT/DLL teardown, which is what stalled in testing.
///  3. Windows are cloaked through DWM and hidden with ShowWindowAsync, on
///     handles recorded at creation, without waiting on the UI thread.
///  4. Other modes run the normal shutdown. In every mode the WebView2 helper
///     processes notice the host is gone and close themselves.
fn shut_down(app: &AppHandle, code: i32) {
    if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    trace!("shut_down code={code}");
    let screensaver = matches!(MODE.get(), Some(Mode::Screensaver));
    let grace = if screensaver { Duration::ZERO } else { EXIT_GRACE };
    if !WATCHDOG.get().is_some_and(|tx| tx.send((grace, code)).is_ok()) {
        std::thread::spawn(move || {
            std::thread::sleep(grace);
            #[cfg(windows)]
            win::terminate_now(code);
            #[cfg(not(windows))]
            std::process::exit(code);
        });
    }
    #[cfg(windows)]
    for raw in WINDOW_HANDLES.lock().map(|v| v.clone()).unwrap_or_default() {
        win::hide_now(raw);
    }
    trace!("windows cloaked");
    // A screen saver is terminated by the watchdog right away; starting the
    // normal exit as well would only race it.
    if !screensaver {
        app.exit(code);
        trace!("exit requested");
    }
}

/// Records a window's native handle so shutdown can hide it without going
/// through the UI thread.
#[cfg(windows)]
fn remember(window: &tauri::WebviewWindow) {
    if let (Ok(h), Ok(mut list)) = (window.hwnd(), WINDOW_HANDLES.lock()) {
        list.push(h.0 as isize);
    }
}
#[cfg(not(windows))]
fn remember(_window: &tauri::WebviewWindow) {}

#[tauri::command]
fn exit_app(app: AppHandle) {
    trace!("page requested exit");
    shut_down(&app, 0);
}

#[tauri::command]
fn is_fullscreen(window: tauri::WebviewWindow) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

#[tauri::command]
fn set_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<(), String> {
    // Only the interactive app window may change its own fullscreen state.
    if !matches!(MODE.get(), Some(Mode::App)) {
        return Ok(());
    }
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

#[tauri::command]
fn use_as_screensaver() -> Result<String, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let scr = exe.with_file_name(SCR_NAME);
        win::use_as_screensaver(&scr)
    }
    #[cfg(not(windows))]
    {
        Err(format!("{SCR_NAME} can only be registered on Windows."))
    }
}

#[tauri::command]
fn open_screensaver_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        win::open_screensaver_settings()
    }
    #[cfg(not(windows))]
    {
        Err("Only available on Windows.".into())
    }
}

// ---- windows ---------------------------------------------------------------

fn page(query: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html?{query}").into())
}

fn base_builder<'a>(app: &'a AppHandle, label: &'a str, query: &str) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, page(query))
        .title("Soundwavian Field")
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .additional_browser_args(BROWSER_ARGS)
        .incognito(true)
        .disable_drag_drop_handler()
}

fn open_app(app: &AppHandle) -> tauri::Result<()> {
    let window = base_builder(app, "main", "mode=app")
        .inner_size(1280.0, 800.0)
        .min_inner_size(480.0, 320.0)
        .center()
        .fullscreen(true)
        .focused(true)
        .build()?;
    remember(&window);
    Ok(())
}

fn open_config(app: &AppHandle, owner: Option<isize>) -> tauri::Result<()> {
    #[allow(unused_mut)]
    let mut builder = base_builder(app, "config", "mode=config")
        .title("Soundwavian Field - Screen Saver Settings")
        .inner_size(760.0, 680.0)
        .min_inner_size(520.0, 520.0)
        .center()
        .focused(true);
    #[cfg(windows)]
    if let Some(h) = owner.filter(|h| win::window_alive(*h)) {
        builder = builder.owner_raw(win::hwnd(h));
    }
    #[cfg(not(windows))]
    let _ = owner;
    let window = builder.build()?;
    remember(&window);
    Ok(())
}

fn open_screensaver(app: &AppHandle) -> tauri::Result<()> {
    let all = config_dir(app).map(|d| settings::all_displays(&d)).unwrap_or(true);
    let primary = app.primary_monitor()?;
    let mut monitors = app.available_monitors()?;
    // Primary first, so it gets display index 0 and keyboard focus.
    if let Some(p) = &primary {
        monitors.sort_by_key(|m| (m.position() != p.position()) as u8);
    }
    if monitors.is_empty() {
        monitors.extend(primary);
    }
    for (i, m) in monitors.iter().enumerate() {
        let query = if i == 0 || all {
            format!("mode=screensaver&display={i}")
        } else {
            format!("mode=screensaver&display={i}&blank=1")
        };
        let window = base_builder(app, &format!("screen{i}"), &query)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(i == 0)
            .build()?;
        remember(&window);
        let pos: PhysicalPosition<i32> = *m.position();
        let size: PhysicalSize<u32> = *m.size();
        window.set_position(pos)?;
        window.set_size(size)?;
        window.set_fullscreen(true)?;
        window.show()?;
        if i == 0 {
            window.set_focus()?;
        }
    }
    Ok(())
}

/// Native dismissal for full-screen mode, independent of the web page: the
/// classic screen saver check. A key, click or wheel (new session input
/// while the cursor stays put) or more than `MOVE_THRESHOLD` px of cursor
/// travel ends the screen saver. The page's own input handling remains the
/// primary path; this guarantees dismissal even if the page stops responding.
#[cfg(windows)]
fn watch_input(app: AppHandle) {
    const MOVE_THRESHOLD: i32 = 10;
    std::thread::spawn(move || {
        // Ignore the input that triggered launch / window creation jitter.
        std::thread::sleep(Duration::from_millis(1000));
        let origin = win::cursor_pos();
        let mut prev_pos = origin;
        let mut prev_tick = win::last_input_tick();
        trace!("watch_input start origin={origin:?} tick={prev_tick:?}");
        let mut polls: u32 = 0;
        loop {
            polls = polls.wrapping_add(1);
            std::thread::sleep(Duration::from_millis(50));
            let pos = win::cursor_pos();
            let tick = win::last_input_tick();
            let moved_far = match (origin, pos) {
                (Some((x0, y0)), Some((x, y))) => (x - x0).abs().max((y - y0).abs()) > MOVE_THRESHOLD,
                _ => false,
            };
            let other_input = tick.is_some() && prev_tick.is_some() && tick != prev_tick && pos == prev_pos;
            if tick != prev_tick || pos != prev_pos || polls % 40 == 0 {
                trace!("poll {polls}: tick {prev_tick:?}->{tick:?} pos {prev_pos:?}->{pos:?} moved_far={moved_far} other_input={other_input}");
            }
            if moved_far || other_input {
                shut_down(&app, 0);
                break;
            }
            prev_pos = pos;
            prev_tick = tick;
        }
    });
}

#[cfg(windows)]
fn open_preview(app: &AppHandle, parent: isize) -> tauri::Result<()> {
    let (w, h) = win::client_size(parent).unwrap_or((152, 112));
    let window = base_builder(app, "preview", "mode=preview")
        .parent_raw(win::hwnd(parent))
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;
    remember(&window);
    window.set_position(PhysicalPosition::new(0, 0))?;
    window.set_size(PhysicalSize::new(w, h))?;
    window.show()?;

    // The preview must never outlive the dialog that hosts it.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        if !win::window_alive(parent) {
            shut_down(&handle, 0);
            break;
        }
    });
    Ok(())
}

fn main() {
    let mode = mode::parse(
        std::env::args().skip(1).collect::<Vec<_>>(),
        invoked_as_scr(),
    );
    if mode == Mode::Exit {
        return;
    }
    trace!("start {mode:?}");
    #[cfg(windows)]
    if let Mode::Preview(h) = mode {
        if !win::window_alive(h) {
            return;
        }
    }
    let _ = MODE.set(mode);
    start_watchdog();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            exit_app,
            is_fullscreen,
            set_fullscreen,
            use_as_screensaver,
            open_screensaver_settings
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            match mode {
                Mode::App => open_app(&handle)?,
                Mode::Config(owner) => open_config(&handle, owner)?,
                Mode::Screensaver => {
                    open_screensaver(&handle)?;
                    #[cfg(windows)]
                    trace!("screens open, hwnds={:?}", WINDOW_HANDLES.lock().map(|v| v.clone()).unwrap_or_default());
                    #[cfg(windows)]
                    watch_input(handle.clone());
                }
                #[cfg(windows)]
                Mode::Preview(parent) => open_preview(&handle, parent)?,
                #[cfg(not(windows))]
                Mode::Preview(_) => handle.exit(0),
                Mode::Exit => handle.exit(0),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Safety net for full-screen mode: if another application takes
            // the foreground (Alt+Tab, Win key, a notification) or the
            // secure desktop appears (Ctrl+Alt+Del), the screen saver ends -
            // even if the page itself has stopped responding. Focus moving
            // between our window and its WebView2 child is ignored, and the
            // check runs only after the window has actually been focused.
            if !matches!(MODE.get(), Some(Mode::Screensaver)) || window.label() != "screen0" {
                return;
            }
            match event {
                WindowEvent::Focused(true) => {
                    trace!("screen0 focused");
                    HAD_FOCUS.store(true, Ordering::SeqCst)
                }
                #[cfg(windows)]
                WindowEvent::Focused(false) => {
                    trace!("screen0 lost focus");
                    if !HAD_FOCUS.load(Ordering::SeqCst) {
                        return;
                    }
                    let handle = window.app_handle().clone();
                    std::thread::spawn(move || {
                        // Let focus settle before deciding.
                        std::thread::sleep(Duration::from_millis(400));
                        if !win::foreground_is_ours() {
                            trace!("foreground taken by another process");
                            shut_down(&handle, EXIT_FOCUS_LOST);
                        }
                    });
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Soundwavian Field");
}
