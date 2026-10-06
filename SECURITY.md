# Security and transparency review

This review covers what Soundwavian Field puts on a Windows PC and what it
does there. Every claim below is either enforced by an automated check, which
fails the build or CI when broken, or measured on a real Windows install by
`scripts/windows/smoke-test.ps1`. The **Evidence** column says which.

The CI runner re-checks this on every push (`.github/workflows/windows-release.yml`).
Each build's own record is in `dist/release/reports/inspection.txt` (MSI database
tables, payload, signatures) and `dist/release/reports/smoke-test-*.txt`
(install/run/uninstall results).

The latest verified run (commit `8a52419`, clean Windows Server 2025 VM) passed every
automated check for both installers. The details are in [docs/RELEASE.md](docs/RELEASE.md#current-status).

## Summary

| Question | Answer | Evidence |
| --- | --- | --- |
| Network endpoints contacted | **None** at runtime | offline audit (build fails on remote URLs, telemetry APIs, or network crates); CSP `connect-src` allows only the in-process IPC scheme; smoke test watches TCP/UDP sockets of the whole process tree while `/s` runs |
| Background services | **None** | MSI `ServiceInstall` table; smoke test service diff |
| Scheduled tasks | **None** | smoke test task diff |
| Startup persistence (Run/RunOnce keys, Startup folders) | **None** | smoke test diff |
| Runtime downloads | **None** | no updater, no HTTP client compiled in, WebView2 install mode `skip` (or an embedded offline installer); audit checks the config |
| Administrator rights | Requested **once, by the installer**, because it installs to `C:\Program Files`. The app and screensaver always run as the user | MSI `ALLUSERS`/NSIS `perMachine`; no elevation manifest on the exe |
| Scripts executed | **None** by the app. The installers run no PowerShell, CMD, VBScript or JScript | MSI `CustomAction` table, generated NSIS source in `dist/release/reports/installer-sources/` |
| Executable packers / compression | **None** (no UPX or similar). Installer payloads use the formats' standard cabinet/LZMA compression | release profile in `src-tauri/Cargo.toml` |

## Final release re-audit: observed facts

Observed on fresh `windows-latest` VMs (Windows Server 2025 Datacenter 10.0.26100, WebView2 153.0.4234.48, software
display adapter), from CI run
[37403856958](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37403856958) on
commit `27e9b61`, the last commit that changed application code (later commits change documentation only).
Both installers (MSI and setup.exe) were installed, exercised in `/a`, `/p`, `/c`, app, `/s` (mouse, keyboard,
outbound-blocked) modes, and uninstalled. Earlier runs on `c91016c` and `64f3bec` showed the same results for every row
below. The release gate with per-check evidence is in [docs/RELEASE.md](docs/RELEASE.md#current-status).

The two columns describe different things. **Soundwavian Field** is what this application's own code does or ships.
**WebView2 / Windows** is normal behaviour of Microsoft's runtime or the OS that any WebView2 application shares.

| Area | Soundwavian Field (application-authored) | WebView2 / Windows (not authored by this app) |
| --- | --- | --- |
| Executables included | Observed: `SoundwavianField.exe`, `SoundwavianField.scr` (10.1 MB each, same compiled binary); NSIS also adds `uninstall.exe` (79 KB). Nothing else | — |
| DLLs / native modules | Observed: **no** `.dll`/`.sys` files installed. The WebView2 loader is linked statically | WebView2 Runtime DLLs live in Microsoft's own runtime folder, serviced by Microsoft |
| WebView2 usage | Renders one locally embedded page per window. InPrivate profile; SmartScreen URL checks, background networking, component updates, domain reliability, sync, pings and crash upload disabled by switch | The runtime starts its usual helper processes (observed: 6 `msedgewebview2.exe`) |
| Child processes | Observed: only `msedgewebview2.exe` under the app. `control.exe` only when the user clicks *Screen Saver Settings…* | Helpers drain within 0.5 s of exit (observed) |
| Registry writes | Installers: uninstall registration and shortcut bookkeeping only (MSI `Registry` table empty). App: `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` **only on the user's click** | Windows Installer/Explorer bookkeeping; `ScreenSaveActive` written by Windows itself via `SystemParametersInfo` |
| Filesystem writes | `C:\Program Files\Soundwavian Field\` (installer); `%APPDATA%\com.soundwavian.field\settings.json` (app). A diagnostic trace file is written only if the `SFIELD_TRACE` environment variable names one (used by the release test; unset in normal use) | WebView2 profile folder `%LOCALAPPDATA%\com.soundwavian.field\EBWebView\` created by the runtime |
| Network endpoints | **None.** No HTTP/socket code compiled in (audited dependency graph), CSP `connect-src` limited to in-process IPC. Observed: **0** non-loopback TCP/UDP sockets from the app and its WebView2 processes during `/s` | The shared WebView2 Runtime and Windows are updated by Microsoft's own updaters on their own schedule. That traffic isn't caused by this application |
| Administrator rights | Installer only (per-machine install to Program Files). Executables run `asInvoker` | UAC prompt shown by Windows |
| Services | **None** (observed: no new service after install or uninstall) | — |
| Scheduled tasks | **None** (observed) | — |
| Run keys | **None** (observed) | — |
| Startup items | **None** (observed) | — |
| Runtime downloads | **None.** No updater; WebView2 install mode `skip` (the bootstrapper download code in Tauri's NSIS template is compiled out) | — |
| Temporary executable execution | **None** by the app | The NSIS *uninstaller* copies itself to `%TEMP%` to delete the install folder (standard NSIS behaviour) |
| PowerShell | **Never** launched (observed child-process list) | — |
| CMD | **Never** launched (observed child-process list) | — |
| Packers / compressors | No executable packer (no UPX or similar step in the pipeline). Observed PE sections: `.text .rdata .data .pdata .rsrc .reloc` only. Installer payloads use the formats' standard MSI cabinet / NSIS LZMA compression | — |
| Imported DLLs | Observed (dumpbin): 23 Windows system DLLs only, e.g. `kernel32`, `user32`, `gdi32`, `dwmapi`, `advapi32`, `ole32`, `shell32`, `api-ms-win-crt-*`. No networking DLL (`ws2_32`, `winhttp`, `wininet`) is imported | — |
| Offline operation | Observed: with outbound traffic blocked by Windows Firewall for the app **and** every `msedgewebview2.exe`, `/s` rendered, opened 0 sockets and exited on input | — |
| Process exit | Observed: the process is gone 0.12–0.57 s after mouse or keyboard input, including the first keystroke since boot; no crash or hang reports. As a screen saver it cloaks its windows and is terminated 0.1 s later by a watchdog thread created at startup; other modes get 1 s to close normally first | Helpers drain within 0.5–2.2 s (observed) |
| Process priority | As a screen saver only, the host process raises itself to above-normal priority (input watcher and watchdog threads to highest), so dismissal stays prompt when software rendering saturates the CPU. Not inherited by the WebView2 processes | — |
| Updater | **None** | — |
| Analytics / telemetry | **None.** The offline audit fails on telemetry APIs. *Copy Diagnostics* writes only to the local clipboard on a user keypress | Windows diagnostic-data settings apply to the OS, not to this app |
| Defender | Observed: MpCmdRun custom scan, "no threats found in 4 files" (setup.exe, MSI, `.scr`, `.exe`), threat count 0. One engine's result on CI signatures, not a guarantee about other engines | Defender is part of Windows |

**Precise network statement:** the Soundwavian Field application logic performs no runtime network requests and
needs no network functionality during normal screensaver operation. It doesn't claim to control what the
Microsoft WebView2 Runtime or Windows do internally on their own schedules.

## 1. Every executable shipped

| File | What it is |
| --- | --- |
| `SoundwavianField.exe` | The application. Rust + Tauri 2. The web assets (HTML/JS/CSS, the three paintings) are embedded in it. |
| `SoundwavianField.scr` | The same compiled binary under the screensaver extension. In `dist/release/` the `.exe` and `.scr` are byte-identical. The installers' copy of the `.exe` differs only by a small installer-type marker that Tauri's bundler stamps in, which is why the installed `.exe` and `.scr` hashes differ. |
| `uninstall.exe` | NSIS installer only: the standard NSIS uninstaller (79 KB; signed in signed builds). |
| Installers | `SoundwavianField-<ver>.msi` (Windows Installer/WiX) and `SoundwavianField-Setup-<ver>.exe` (NSIS). |

No other executables are installed. The installer never extracts and runs a
helper executable. The one optional exception is the `--webview-offline`
build flavour, which embeds Microsoft's own signed WebView2 runtime installer
and runs it only if WebView2 is missing.

## 2. DLLs and native modules

**We ship no DLLs.** CI confirms that the installed folder holds exactly
`SoundwavianField.exe`, `SoundwavianField.scr`, `LICENSE-ASSETS.txt` and a
shortcut (plus `uninstall.exe` for the NSIS installer). The executable links
only to Windows system libraries, and the WebView2 loader is linked
statically, so there's no `WebView2Loader.dll`. `inspection.txt` lists the
exact import table when `dumpbin` is available on the build machine. Rendering happens in the
Microsoft Edge **WebView2 Runtime**, a Microsoft-signed, Microsoft-serviced
OS component that isn't part of our package.

## 3. Child processes

| Process | When | Visible? |
| --- | --- | --- |
| `msedgewebview2.exe` (6 observed in CI: browser, renderer, GPU, utility…) | Started by the WebView2 runtime for our window | Normal processes, exit with the window |
| `control.exe desk.cpl,,@screensaver` | Only when you click **Screen Saver Settings…** | Opens the standard visible Control Panel dialog |

There are no hidden windows, CMD/PowerShell launches, or background
processes. The preview (`/p`) process exits within ~0.4 s of the Screen Saver
dialog closing. The smoke test kills the main process and confirms that every
descendant process is gone.

## 4. Registry keys written

Observed from the built installers (MSI database tables and the generated
NSIS script, both dumped by CI):

| Key / value | Written by | Notes |
| --- | --- | --- |
| Windows Installer's own product registration (`…\Installer\…`, Add/Remove Programs) | MSI engine | Standard for every MSI. The package's own `Registry` table is **empty** |
| `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\<product key>`: `DisplayName`, `DisplayIcon`, `DisplayVersion`, `Publisher`, `InstallLocation`, `UninstallString`, `NoModify`, `NoRepair`, `EstimatedSize` | NSIS installer | Add/Remove Programs entry; deleted on uninstall |
| `HKLM\Software\<Publisher>\<Product>` (default value = install folder; exact key names in the generated NSIS script) | NSIS installer | Deleted on uninstall |
| `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` | **The app, only when you click "Use as my screen saver"** | The same per-user value the Windows Screen Saver dialog writes. The NSIS uninstaller clears it if it points at our `.scr` |
| `HKCU\Control Panel\Desktop\ScreenSaveActive` | Windows itself, via `SystemParametersInfo(SPI_SETSCREENSAVEACTIVE)` | Same click |

Nothing else is written: no Run keys, file associations, URL protocols, shell
extensions, COM registration, firewall rules or policy keys. (Tauri's NSIS
uninstaller also *deletes* an `HKCU\…\Run\Soundwavian Field` value if one
exists, as part of its generic cleanup. We never create one.)

## 5. File-system locations written

| Location | By | Content |
| --- | --- | --- |
| `C:\Program Files\Soundwavian Field\` | Installer | The files in §1 plus `LICENSE-ASSETS.txt` |
| Start Menu (`%ProgramData%\Microsoft\Windows\Start Menu\Programs\`) | Installer | `Soundwavian Field` shortcut |
| Desktop | Installer | `Soundwavian Field` shortcut (MSI always; NSIS when the finish-page box is ticked) |
| Install folder | MSI | an `Uninstall Soundwavian Field` shortcut (runs `msiexec /x {ProductCode}`) |
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
VBScript, JScript, HTA or batch files.

The MSI's complete `CustomAction` table, observed in CI:

| Action | Type | What it is |
| --- | --- | --- |
| `LaunchApplication` | 210 | The optional "Launch Soundwavian Field" checkbox on the final page; runs the installed exe |
| `WixUIValidatePath`, `WixUIPrintEula` | 65 | WiX's standard UI helper DLL (install-folder validation, print button) |
| `SetARPNOMODIFY`, `SetARPINSTALLLOCATION` | 51 | Set Add/Remove Programs properties |

There are no script custom actions (types 5/6/21/22/37/38). The NSIS script
(`dist/release/reports/installer-sources/nsis-installer.nsi`) contains Tauri's WebView2
download/bootstrap code only inside `!if` blocks that are compiled **out**
for this project's install mode (`skip`). Its only `ExecWait`s are for
uninstalling a previous version. The PowerShell under `scripts/windows/` is
developer and CI tooling and isn't shipped.

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
