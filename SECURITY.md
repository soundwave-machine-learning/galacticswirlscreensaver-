# Security and transparency review

This review covers what Soundwavian Field puts on a Windows PC and what it
does there. Every claim below is either enforced by an automated check, which
fails the build or CI when broken, or measured on a real Windows install by
`scripts/windows/smoke-test.ps1`. The **Evidence** column says which.

The CI runner re-checks this on every push (`.github/workflows/windows-release.yml`).
Each build's own record is in `dist/release/inspection.txt` (MSI database
tables, payload, signatures) and `dist/release/smoke-test-*.txt`
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
| Scripts executed | **None** by the app. The installers run no PowerShell, CMD, VBScript or JScript | MSI `CustomAction` table, generated NSIS source in `dist/release/inspection/` |
| Executable packers / compression | **None** (no UPX or similar). Installer payloads use the formats' standard cabinet/LZMA compression | release profile in `src-tauri/Cargo.toml` |

## 1. Every executable shipped

| File | What it is |
| --- | --- |
| `SoundwavianField.exe` | The application. Rust + Tauri 2. The web assets (HTML/JS/CSS, the three paintings) are embedded in it. |
| `SoundwavianField.scr` | The same compiled binary under the screensaver extension. In `dist/release/` the `.exe` and `.scr` are byte-identical. The installers' copy of the `.exe` differs only by a small installer-type marker that Tauri's bundler stamps in, which is why the installed `.exe` and `.scr` hashes differ. |
| `uninstall.exe` | NSIS installer only: the standard NSIS uninstaller (79 KB; signed in signed builds). |
| Installers | `SoundwavianField-<ver>-x64.msi` (Windows Installer/WiX) and `SoundwavianField-<ver>-x64-setup.exe` (NSIS). |

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
(`dist/release/inspection/nsis-installer.nsi`) contains Tauri's WebView2
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
