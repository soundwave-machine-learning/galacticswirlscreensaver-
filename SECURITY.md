# Security and transparency review

This review covers what Soundwavian Field puts on a Windows PC and what it
does there. Every claim below is either enforced by an automated check, which
fails the build or CI when broken, or measured on a real Windows install by
`scripts/windows/smoke-test.ps1`. The **Evidence** column says which.

The CI runner re-checks this on every push (`.github/workflows/windows-release.yml`).
Each build's own record is in `dist/release/inspection.txt` (MSI database
tables, payload, signatures) and `dist/release/smoke-test-*.txt`
(install/run/uninstall results).

Status of the latest CI run is recorded in [docs/RELEASE.md](docs/RELEASE.md#current-status).

## Summary

| Question | Answer | Evidence |
| --- | --- | --- |
| Network endpoints contacted | **None** at runtime | offline audit (build fails on remote URLs, telemetry APIs, or network crates); CSP `connect-src` allows only the in-process IPC scheme; smoke test watches TCP/UDP sockets of the whole process tree while `/s` runs |
| Background services | **None** | MSI `ServiceInstall` table; smoke test service diff |
| Scheduled tasks | **None** | smoke test task diff |
| Startup persistence (Run/RunOnce keys, Startup folders) | **None** | smoke test diff |
| Runtime downloads | **None** | no updater, no HTTP client compiled in, WebView2 install mode `skip` (or an embedded offline installer); audit checks the config |
| Administrator rights | Requested **once, by the installer**, because it installs to `C:\Program Files`. The app and screensaver always run as the user | MSI `ALLUSERS`/NSIS `perMachine`; no elevation manifest on the exe |
| Scripts executed | **None** by the app. The installers run no PowerShell, CMD, VBScript or JScript | MSI `CustomAction` table, generated NSIS source in `dist/release/inspection/` |
| Executable packers / compression | **None** (no UPX or similar). Installer payloads use the formats' standard cabinet/LZMA compression | release profile in `src-tauri/Cargo.toml` |

## 1. Every executable shipped

| File | What it is |
| --- | --- |
| `SoundwavianField.exe` | The application. Rust + Tauri 2. The web assets (HTML/JS/CSS, the three paintings) are embedded in it. |
| `SoundwavianField.scr` | The same executable under the screensaver extension. Byte-identical in development builds; in signed builds it's the same compiled output, signed. |
| `uninstall.exe` | NSIS installer only: the standard NSIS uninstaller (signed in signed builds). |
| Installers | `SoundwavianField-<ver>-x64.msi` (Windows Installer/WiX) and `SoundwavianField-<ver>-x64-setup.exe` (NSIS). |

No other executables are installed. The installer never extracts and runs a
helper executable. The one optional exception is the `--webview-offline`
build flavour, which embeds Microsoft's own signed WebView2 runtime installer
and runs it only if WebView2 is missing.

## 2. DLLs and native modules

**We ship no DLLs.** The executable links only to Windows system libraries
(kernel32, user32, ole32, advapi32, gdi32, shell32, etc. — `inspection.txt`
lists the exact import table when `dumpbin` is available on the build machine)
and loads `WebView2Loader` logic statically. Rendering happens in the
Microsoft Edge **WebView2 Runtime**, a Microsoft-signed, Microsoft-serviced
OS component that isn't part of our package.

## 3. Child processes

| Process | When | Visible? |
| --- | --- | --- |
| `msedgewebview2.exe` (several: browser, renderer, GPU, utility) | Started by the WebView2 runtime for our window | Normal processes, exit with the window |
| `control.exe desk.cpl,,@screensaver` | Only when you click **Screen Saver Settings…** | Opens the standard visible Control Panel dialog |

There are no hidden windows, CMD/PowerShell launches, or background
processes. The preview (`/p`) process exits within ~0.4 s of the Screen Saver
dialog closing. The smoke test kills the main process and confirms that every
descendant process is gone.

## 4. Registry keys written

| Key | Written by | When |
| --- | --- | --- |
| `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\…` | Installer | Install. This is the standard Add/Remove Programs entry |
| Windows Installer's own bookkeeping (MSI), `HKLM\Software\Soundwavian Field Publisher (placeholder)\Soundwavian Field` (NSIS install path) | Installer | Install; removed on uninstall |
| `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` | **The app, only when you click "Use as my screen saver"** | This is the same per-user value the Windows Screen Saver dialog writes. The NSIS uninstaller clears it if it points at our `.scr` |
| `HKCU\Control Panel\Desktop\ScreenSaveActive` | Windows itself, via `SystemParametersInfo(SPI_SETSCREENSAVEACTIVE)` | Same click |

Nothing else is written. That means no Run keys, file associations, URL
protocols, shell extensions, COM registration, firewall rules or policy keys.
The full MSI `Registry` table for each build is in `inspection.txt`.

## 5. File-system locations written

| Location | By | Content |
| --- | --- | --- |
| `C:\Program Files\Soundwavian Field\` | Installer | The files in §1 plus `LICENSE-ASSETS.txt` |
| Start Menu (`%ProgramData%\Microsoft\Windows\Start Menu\Programs\`) | Installer | `Soundwavian Field` shortcut (plus an optional desktop shortcut) |
| `%APPDATA%\com.soundwavian.field\settings.json` | App | Your settings (validated JSON, ≤64 KB, written atomically via a `.tmp` file in the same folder) |
| `%LOCALAPPDATA%\com.soundwavian.field\EBWebView\` | WebView2 runtime | Browser profile folder. The app runs WebView2 InPrivate, so no cache or storage is persisted beyond the runtime's own housekeeping |

The app never writes to Temp, Downloads, System32 or any other location, and it
never writes or runs an executable. The NSIS uninstaller copies itself to Temp
to delete the install folder; that's standard NSIS behaviour.

## 6. Network endpoints

**Runtime: none.**

- No HTTP client, socket, updater, analytics or crash-reporting code is
  compiled in. `scripts/audit-offline.mjs --native` fails the release if
  `reqwest`, `hyper`, `ureq`, `curl`, TLS stacks, websockets or Tauri
  updater/http/shell plugins appear in the Windows dependency graph.
- The page is served from inside the executable through Tauri's custom
  scheme. Its Content-Security-Policy is `default-src 'self'`, and
  `connect-src` allows only `ipc:`/`http://ipc.localhost`, the in-process IPC
  bridge that WebView2 intercepts locally.
- WebView2 is started with SmartScreen URL checks, background networking,
  component updates, domain reliability reporting, sync, pings and crash
  upload all disabled (`BROWSER_ARGS` in `src-tauri/src/main.rs`).
- The smoke test records every non-loopback TCP connection and UDP endpoint of
  the app's whole process tree while the screensaver runs.

Honest caveat: the WebView2 Runtime is a shared Microsoft OS component. It's
updated by Microsoft's Edge updater on Microsoft's schedule, independently
of this app, the same way Windows Update works. That isn't caused or
controlled by Soundwavian Field.

**Build time (developer machine / CI only):** npm and crates.io packages, the
WiX and NSIS toolsets that the Tauri CLI downloads (hash-verified), and, for
signed builds, the certificate authority's timestamp server.

## 7. Administrator privileges

Only the installer elevates, once, to write to `C:\Program Files`. The
executable carries the default `asInvoker` manifest and never requests
elevation.

## 8. Persistence

None. The screensaver runs only when Windows starts it (after the idle
timeout you configure) or when you run it yourself. When it ends, every
process ends.

## 9. Scripts executed

The app executes only its own bundled JavaScript inside WebView2 (no `eval`,
no remote code; CSP `script-src 'self'`). It never runs PowerShell, CMD,
VBScript, JScript, HTA or batch files. The MSI has no script custom actions,
which you can confirm in the `CustomAction` table in `inspection.txt`. The
PowerShell under `scripts/windows/` is developer and CI tooling and isn't
shipped.

## 10. Downloads after installation

None. There's no updater. Any future updater will be a separate, opt-in
feature.

## IPC surface (what the page can ask the native side to do)

`load_settings`, `save_settings` (validated JSON in the app's own config
folder), `exit_app`, `is_fullscreen`, `set_fullscreen` (app window only),
`use_as_screensaver` (the per-user value above, on click),
`open_screensaver_settings` (Control Panel dialog, on click). No Tauri core or
plugin permissions are granted: there's no file system, shell, HTTP, clipboard,
dialog or window-management access beyond these seven commands.

## Reporting a problem

If a security tool flags a build, please send the file's SHA-256 (from
`SHA256SUMS.txt`) and the detection name. Never upload the binaries to
third-party scanning services without the publisher's permission. See
[docs/RELEASE.md](docs/RELEASE.md#reputation-testing).
