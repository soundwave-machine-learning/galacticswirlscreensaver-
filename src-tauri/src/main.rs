//! Soundwavian Field - Windows host.
//!
//! One conventional executable, shipped twice by the installer under stable
//! names: `SoundwavianField.exe` (the app) and a byte-identical
//! `SoundwavianField.scr` (the screen saver entry point). It renders a
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
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Chromium switches for the embedded WebView2: keep the defaults wry uses
/// (SmartScreen / out-of-process UI off - there is no web content to vet,
/// only local files) and switch off every background network service.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--disable-background-networking --disable-component-update --disable-domain-reliability \
--disable-sync --no-pings --disable-breakpad";

const SCR_NAME: &str = "SoundwavianField.scr";

static MODE: OnceLock<Mode> = OnceLock::new();
static STARTED: OnceLock<Instant> = OnceLock::new();

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

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
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
    base_builder(app, "main", "mode=app")
        .inner_size(1280.0, 800.0)
        .min_inner_size(480.0, 320.0)
        .center()
        .fullscreen(true)
        .focused(true)
        .build()?;
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
    builder.build()?;
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
    window.set_position(PhysicalPosition::new(0, 0))?;
    window.set_size(PhysicalSize::new(w, h))?;
    window.show()?;

    // The preview must never outlive the dialog that hosts it.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        if !win::window_alive(parent) {
            handle.exit(0);
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
    #[cfg(windows)]
    if let Mode::Preview(h) = mode {
        if !win::window_alive(h) {
            return;
        }
    }
    let _ = MODE.set(mode);
    let _ = STARTED.set(Instant::now());

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
                Mode::Screensaver => open_screensaver(&handle)?,
                #[cfg(windows)]
                Mode::Preview(parent) => open_preview(&handle, parent)?,
                #[cfg(not(windows))]
                Mode::Preview(_) => handle.exit(0),
                Mode::Exit => handle.exit(0),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Safety net for full-screen mode: if the primary screen saver
            // window loses focus (Alt+Tab, Win key, Ctrl+Alt+Del, a
            // notification stealing focus) the screen saver ends, even if
            // the page itself has stopped responding.
            if let (Some(Mode::Screensaver), WindowEvent::Focused(false)) = (MODE.get(), event) {
                let settled = STARTED.get().map(|t| t.elapsed() > Duration::from_secs(2)).unwrap_or(true);
                if settled && window.label() == "screen0" {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Soundwavian Field");
}
