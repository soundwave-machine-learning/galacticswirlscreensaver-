# Windows: architecture, screensaver behaviour and installers

## Architecture decision

**Chosen: a single small Rust executable (Tauri 2) that renders the bundled
WebGL page in the system WebView2 runtime, packaged as a standard MSI and a
standard NSIS installer.**

| Option | Verdict |
| --- | --- |
| Electron | ❌ ~150 MB with a full bundled Chromium, ~100 DLL/resource files, and `.scr` support means renaming `electron.exe`. Large and unusual, and exactly the kind of package that has produced false positives before. |
| Tiny native `.scr` launcher + separate renderer | ❌ Needs two processes. Windows supervises the `.scr` process, so the launcher would have to stay alive and forward `/p <HWND>` parenting across process boundaries. That's more moving parts and more for behavioural heuristics to look at. |
| **Tauri 2 + WebView2 (chosen)** | ✅ One ~10 MB PE file, no bundled browser, no DLLs of our own. WebView2 is a Microsoft-serviced OS component (in-box on Windows 11, delivered by Windows Update on Windows 10). Standard MSI (WiX) and NSIS installers, Authenticode hooks built in. The `.scr` arguments are implemented natively in Rust. |

The `.scr` **isn't** an arbitrary executable renamed. `src-tauri/src/mode.rs`
implements the screensaver command-line contract, and the binary checks its
own extension:

| Invocation | Behaviour |
| --- | --- |
| `SoundwavianField.scr /s` | Full screen on every monitor (or primary only, per settings), always on top, cursor hidden. Any key, click, wheel, touch or real mouse movement exits at once. If the window loses focus (Alt+Tab, Win key, Ctrl+Alt+Del) the process exits too. |
| `SoundwavianField.scr /p <HWND>` | Live preview inside the Screen Saver Settings dialog: a child window of `<HWND>` at low quality. The process checks the host window every 400 ms and exits as soon as the dialog closes. An invalid HWND exits immediately. |
| `SoundwavianField.scr /c` or `/c:<HWND>` | Settings window, owned by the dialog when an HWND is given. |
| `SoundwavianField.scr` (no arguments, e.g. double-click) | Settings window (Windows convention for `.scr`). |
| `SoundwavianField.scr /a` | Legacy password option; accepted and ignored (exits). |
| `SoundwavianField.exe` | The interactive app: starts full screen and plays autonomously; the mouse reveals the panel. |

Switches are case-insensitive, accept `-` as well as `/`, and the HWND can
follow a colon or come as the next argument. All of this is covered by unit
tests (`npm run test:native`).

## What the installers do

Both installers are **per-machine** (they ask for administrator approval once,
because they install under `C:\Program Files`) and do only this:

| Item | Value |
| --- | --- |
| Install directory | `C:\Program Files\Soundwavian Field\` |
| Files | `SoundwavianField.exe`, `SoundwavianField.scr`, `LICENSE-ASSETS.txt` (NSIS also adds `uninstall.exe`) |
| Start Menu | `Soundwavian Field` shortcut → `SoundwavianField.exe` |
| Desktop shortcut | Tauri's standard templates: NSIS offers it as a finish-page checkbox; for the MSI see the `Shortcut` table in `inspection.txt` |
| Add/Remove Programs | Standard uninstall entry (publisher, version, icon) |
| Registry | Only uninstall registration and shortcut bookkeeping. The exact keys of each build are listed in `dist/release/inspection.txt` and summarised in [SECURITY.md](../SECURITY.md) |
| Services, scheduled tasks, Run keys, Startup items | **None** |
| WebView2 runtime | Not downloaded. Present on Windows 11 and on updated Windows 10. For machines without it (e.g. Windows 10 LTSC), build with `--webview-offline` to embed Microsoft's offline runtime installer |

**Uninstall** removes the files and shortcuts. The NSIS uninstaller also
clears `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` *if, and only if,* it still
points at our `.scr`. The MSI leaves that one per-user value in place. Windows
ignores a screensaver path that no longer exists, and the value is overwritten
the next time you pick a screensaver. Per-user settings in
`%APPDATA%\com.soundwavian.field\` and the WebView2 cache in
`%LOCALAPPDATA%\com.soundwavian.field\` remain after uninstall, as is
conventional for user data. Delete those folders to remove every trace.

## Using it as your screensaver

The `.scr` lives in Program Files rather than `System32`, so the installer
never writes to a system directory. Choose any one of these:

1. **From the app:** open *Soundwavian Field* from the Start Menu, move the
   mouse, then click **Use as my screen saver** in the panel. That writes the
   one per-user value Windows uses
   (`HKCU\Control Panel\Desktop\SCRNSAVE.EXE`, stored as a short 8.3 path the
   same way the Windows dialog stores it) and enables the screensaver.
   **Screen Saver Settings…** then opens the standard dialog so you can set
   the wait time.
   The dialog lists it as **Soundwavian Field**: the `.scr` carries string
   resource 1 (`IDS_DESCRIPTION`), the name Windows uses for a screensaver.
2. **From Explorer:** right-click `C:\Program Files\Soundwavian Field\SoundwavianField.scr` → **Install**.
3. **Test it:** right-click the `.scr` → **Test**, or run `SoundwavianField.scr /s`.

## Settings and data

| What | Where |
| --- | --- |
| Settings (preset, sliders, quality, displays) | `%APPDATA%\com.soundwavian.field\settings.json` (written atomically, ≤64 KB, validated JSON) |
| WebView2 profile/cache (created by the runtime) | `%LOCALAPPDATA%\com.soundwavian.field\EBWebView\` (InPrivate mode, so little is kept) |

## Packaging it later as a Windows `.scr` (and other distribution forms)

The project already produces a correct `.scr`, so "packaging later" just means
choosing a distribution form:

- **Recommended:** ship the **signed MSI** (or the signed setup `.exe`). It
  installs the app and the `.scr` together, with a clean uninstall.
- **Standalone `.scr` (portable):** `dist/release/SoundwavianField.scr` runs on
  its own (the web assets are embedded in the executable) as long as WebView2
  is present. Users right-click it → **Install**. Sign it first. Unsigned
  portable `.scr` files are exactly what SmartScreen and antivirus treat with
  the most suspicion.
- **System-wide listing in the dialog's dropdown:** Windows lists `.scr` files
  from `%WINDIR%\System32` automatically. We deliberately *don't* install
  there: writing to System32 is a system-wide change that isn't needed. If an
  organisation wants that, an administrator can copy the signed `.scr` there
  with their own deployment tooling.
- **Microsoft Store (MSIX):** possible later with the same binary, but MSIX
  sandboxing complicates `.scr` registration. Not pursued for now.

## Building on Windows

Prerequisites: Windows 10/11 x64, [Rust](https://rustup.rs) (MSVC toolchain),
Visual Studio Build Tools with the C++ workload, and Node.js 22. The Tauri CLI
downloads its WiX and NSIS toolsets on first bundle. That's build-machine
network access only, never at runtime.

```powershell
npm ci
npm run release                                          # unsigned DEVELOPMENT build
pwsh scripts\windows\inspect-release.ps1                 # static installer inspection
pwsh scripts\windows\smoke-test.ps1 -Installer (gci dist\release\*.msi).FullName   # elevated, ideally on a clean VM
```

CI (`.github/workflows/windows-release.yml`) runs all of the above on a clean
`windows-latest` runner on every push, and uploads `dist/release/`.
