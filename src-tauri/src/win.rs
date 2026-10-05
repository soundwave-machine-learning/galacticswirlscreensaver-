//! The only Windows-specific operations the app performs. Each is explicit,
//! user-initiated (except the preview-parent liveness check), and documented
//! in SECURITY.md.

use std::path::{Path, PathBuf};

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Storage::FileSystem::GetShortPathNameW;
use windows::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SystemParametersInfoW,
    SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETSCREENSAVEACTIVE,
};

pub fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

/// True while the given window still exists (used to end the preview
/// process as soon as the Screen Saver Settings dialog closes).
pub fn window_alive(raw: isize) -> bool {
    unsafe { IsWindow(Some(hwnd(raw))).as_bool() }
}

/// True when the foreground window belongs to this process. Keyboard focus
/// moving between our own window and its embedded WebView2 child is not
/// "the user switched away"; another process (or the secure desktop, which
/// leaves no foreground window) is.
pub fn foreground_is_ours() -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        pid == std::process::id()
    }
}

/// Client-area size of the preview host window, in physical pixels.
pub fn client_size(raw: isize) -> Option<(u32, u32)> {
    let mut rect = RECT::default();
    unsafe { GetClientRect(hwnd(raw), &mut rect).ok()? };
    let w = (rect.right - rect.left).max(1) as u32;
    let h = (rect.bottom - rect.top).max(1) as u32;
    Some((w, h))
}

/// 8.3 form of a path when the volume provides one. The Windows Screen
/// Saver dialog itself stores SCRNSAVE.EXE as a short path, because the
/// value is used to build a command line ("<path> /s"); a path with spaces
/// is never stored unquoted.
fn short_path(path: &Path) -> PathBuf {
    let wide = HSTRING::from(path.as_os_str());
    let mut buf = vec![0u16; 1024];
    let len = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buf)) } as usize;
    if len == 0 || len >= buf.len() {
        return path.to_path_buf();
    }
    PathBuf::from(String::from_utf16_lossy(&buf[..len]))
}

/// Selects our `.scr` as the current user's screen saver - exactly the
/// per-user value the Screen Saver Settings dialog writes:
///   HKCU\Control Panel\Desktop  SCRNSAVE.EXE = <path to .scr>
/// and enables the screen saver via SystemParametersInfo. Nothing else.
pub fn use_as_screensaver(scr: &Path) -> Result<String, String> {
    if !scr.is_file() {
        return Err(format!("{} was not found. Reinstall Soundwavian Field.", scr.display()));
    }
    let stored = short_path(scr);
    let stored_str = stored.to_string_lossy().to_string();
    if stored_str.contains(' ') {
        return Err(
            "This drive does not provide short (8.3) file names, so Windows cannot start a \
             screen saver from a folder whose path contains spaces. Choose Soundwavian Field \
             in Screen Saver Settings instead."
                .into(),
        );
    }
    let value: Vec<u16> = stored_str.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = unsafe { core::slice::from_raw_parts(value.as_ptr() as *const u8, value.len() * 2) };
    let status = unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from("Control Panel\\Desktop"),
            &HSTRING::from("SCRNSAVE.EXE"),
            REG_SZ.0,
            Some(bytes.as_ptr() as *const core::ffi::c_void),
            bytes.len() as u32,
        )
    };
    if status.is_err() {
        return Err(format!("Could not update the screen saver setting ({status:?})."));
    }
    unsafe {
        SystemParametersInfoW(
            SPI_SETSCREENSAVEACTIVE,
            1,
            None,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(scr.display().to_string())
}

/// Opens the standard Screen Saver Settings dialog (a visible Control
/// Panel window - never hidden) using the absolute System32 path.
pub fn open_screensaver_settings() -> Result<(), String> {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let control = PathBuf::from(root).join("System32").join("control.exe");
    std::process::Command::new(control)
        .arg("desk.cpl,,@screensaver")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
