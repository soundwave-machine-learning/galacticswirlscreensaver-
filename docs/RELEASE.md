# Release process and release gate

## Pipeline

```
source
  → production web build (npm run build: type-check, Vite, offline audit)
  → native audit (no network-capable crates, no plugins, no WebView2 download)
  → native unit tests (.scr argument parsing, settings)
  → native build (cargo, release profile, no packer)
  → sign SoundwavianField.exe                      [signed builds]
  → stage SoundwavianField.scr (copy of the signed exe)
  → bundle MSI + NSIS installers                   [Tauri signs uninstaller + installers in signed builds]
  → verify signatures (signtool verify /pa /all)   [signed builds]
  → Microsoft Defender scan (MpCmdRun)             [when available]
  → SHA-256 manifest, build-info.json, VERSION.txt
  → static inspection (MSI tables, payload, signatures)   scripts/windows/inspect-release.ps1
  → clean-machine install / run / uninstall test          scripts/windows/smoke-test.ps1
  → release
```

Commands (Windows):

```powershell
npm ci
npm run release:signed                     # or `npm run release` for an unsigned DEVELOPMENT build
pwsh scripts\windows\inspect-release.ps1
# on a clean Windows 10/11 VM, elevated:
pwsh scripts\windows\smoke-test.ps1 -Installer .\SoundwavianField-0.1.0-x64.msi
pwsh scripts\windows\smoke-test.ps1 -Installer .\SoundwavianField-0.1.0-x64-setup.exe
```

### Reproducibility

- Dependency versions are pinned exactly (`package-lock.json`, `src-tauri/Cargo.lock`, exact versions in `package.json`).
- `SOURCE_DATE_EPOCH` is set to the commit time, and `build-info.json` records the commit, the dirty flag and toolchain versions.
- File names and identity are stable: `SoundwavianField.exe` / `.scr`, product name, identifier
  `com.soundwavian.field`, and a fixed MSI UpgradeCode `f9049658-7c7b-5ad7-af92-f1a0f32953e9`.
- The installers contain only the built executable, the `.scr` and `LICENSE-ASSETS.txt`. No source code, source maps
  (the audit fails on `.map` files) or debug symbols (the `.pdb` stays in `target/`).

## Release gate

Do **not** give a build to another person until every box is ticked for *that*
build (same SHA-256s).

| Gate | How it's checked | Automated? |
| --- | --- | --- |
| Clean production build | `npm run release` finishes with no errors | ✅ CI |
| No unexpected networking | offline audit (bundle + native graph + config) and the smoke test's socket watch during `/s` | ✅ CI |
| No hidden scripts | MSI `CustomAction` table + generated NSIS source reviewed (`dist/release/inspection/`) | ✅ table dump in CI; review is manual |
| No executable packer | release profile; PE inspection | ✅ by construction |
| Conventional installer | Tauri's standard WiX MSI + NSIS | ✅ |
| Uninstall works | smoke test step 6 | ✅ CI (MSI + NSIS) |
| Normal Windows metadata | smoke test prints ProductName, CompanyName, FileDescription, OriginalFilename, version, copyright | ✅ CI (check the values) |
| Defender scan clean | `defender-scan.txt` | ⚠️ the CI image usually has Defender disabled, so scan on the release machine |
| Clean-machine / VM install tested | smoke test on a fresh Windows 10 **and** 11 VM, plus a manual look | ❌ manual |
| `.scr` invocation behaviour tested | unit tests + smoke test (`/a`, `/p` with an invalid HWND, `/s`) + **manual** checks of `/c`, the live preview in the Screen Saver dialog, and dismiss-on-input | ⚠️ partly manual |
| Application exits completely | smoke test: no descendant process survives the main process | ✅ CI; also check after dismissing with the mouse |
| SHA-256 manifest generated | `SHA256SUMS.txt` | ✅ |
| Signing configuration documented | [SIGNING.md](SIGNING.md) | ✅ |
| **Signed** with the publisher's certificate | `build-info.json` → `"signed": true`; `signtool verify` passes | ❌ needs a certificate |
| Placeholders replaced | `bundle.publisher` / `copyright` in `tauri.conf.json` match the certificate subject | ❌ needs the publisher's name |
| Real-GPU performance | 60 fps on the target PCs (press **D** for the stats overlay; Auto quality steps down on its own) | ❌ manual |

### Manual checklist for the VM test

1. Fresh Windows 11 (and Windows 10 22H2) VM, fully updated, Defender on, **network disconnected**.
2. Copy the installer and `SHA256SUMS.txt` over; check the hash: `Get-FileHash .\SoundwavianField-*.msi`.
3. Double-click the MSI. Note any SmartScreen prompt, then check the UAC dialog's publisher name and the Add/Remove Programs entry.
4. Start **Soundwavian Field** from the Start Menu → fullscreen, no UI until the mouse moves. Try every key (Space, F, →, M, P, R, Esc, 1–5, D).
5. Panel → **Use as my screen saver** → **Screen Saver Settings…**. The dialog shows it, and the small preview animates. Click **Settings…** (the `/c` window opens) and **Preview** (`/s`).
6. Let the screensaver start by itself. Wiggle the mouse: it exits at once. Check Task Manager: no `SoundwavianField` or orphaned `msedgewebview2` processes remain.
7. Multi-monitor (if available): every display is covered; "Primary display only" leaves the others black.
8. Run the smoke test (elevated) for both installers.
9. Uninstall. Reboot. Check Task Manager → Startup apps, Services, Task Scheduler: nothing from Soundwavian Field.
10. Defender full scan of the install folder before uninstalling: `"%ProgramFiles%\Windows Defender\MpCmdRun.exe" -Scan -ScanType 3 -File "C:\Program Files\Soundwavian Field"`.

## Reputation testing

Nothing in this repository uploads binaries anywhere. Once you've decided a
release is public, you can **manually** improve or check its reputation:

- Submit the signed installer to **Microsoft Security Intelligence**
  (<https://www.microsoft.com/wdsi/filesubmission>) as *software developer → incorrectly detected / for analysis*.
  This is the official route for false-positive reviews and for building SmartScreen trust.
- Check the hashes from `SHA256SUMS.txt` on a multi-engine scanner. Searching
  by **hash** doesn't upload the file; only upload with the publisher's consent,
  since uploads become available to third parties.
- If any engine flags the build, report it to that vendor with the hash and
  the signed installer, and don't distribute until it's resolved.

## Current status

See the bottom of this file, which is updated as CI runs.
