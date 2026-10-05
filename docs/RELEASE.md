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
| Defender scan clean | `defender-scan.txt` (MpCmdRun custom scan of every artifact) | ✅ CI; repeat for the signed build on the release machine |
| Clean-machine / VM install tested | [PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) on Windows 11 and 10, plus the smoke test on a fresh VM | ❌ manual |
| `.scr` invocation behaviour tested | unit tests + smoke test (`/a`, `/p` with an invalid HWND, `/s`) + **manual** checks of `/c`, the live preview in the Screen Saver dialog, and dismiss-on-input | ⚠️ partly manual |
| Application exits completely | smoke test: no descendant process survives the main process | ✅ CI; also check after dismissing with the mouse |
| SHA-256 manifest generated | `SHA256SUMS.txt` | ✅ |
| Signing configuration documented | [SIGNING.md](SIGNING.md) | ✅ |
| **Signed** with the publisher's certificate | `build-info.json` → `"signed": true`; `signtool verify` passes | ❌ needs a certificate |
| Publisher identity final | `Soundwave Machine Learning` in `tauri.conf.json`; if the certificate is issued to another legal name, set `SFIELD_PUBLISHER` (see [SIGNING.md](SIGNING.md)) | ✅ set; must match the certificate subject |
| Real-GPU performance | 60 fps per preset, recorded with the **D** overlay (avg, min, tier, GPU) per [PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) §6 | ❌ manual |

### Manual checklist

The hands-on checklist, written for a non-developer, is
[PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md). It covers installation
and SmartScreen, the screensaver dialog, preview, settings, displays and DPI,
per-preset performance, system behaviour, a fresh-profile first launch,
reboot, and uninstall.

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

**Version 0.1.0, commit `c91016c`, DEVELOPMENT (unsigned) build.**
**Distribution-ready except for (1) the user-supplied code-signing certificate and (2) the physical Windows 10/11 gate, which hasn't been performed yet.**

Automated evidence: CI run [#37281442442](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37281442442),
passed **3 of 3** attempts on the same commit. Each attempt was a fresh `windows-latest` VM: Windows Server 2025
Datacenter 10.0.26100, WebView2 153.0.4234.48, a software display adapter, and the MSI and EXE installers each
installed, run and uninstalled. Attempt 3 artifacts:

| File | SHA-256 |
| --- | --- |
| `SoundwavianField-0.1.0-x64.msi` | `56572bcc54ede60d84856d67c49ab4298e9954183e4c46eaef7855b442e81dc8` |
| `SoundwavianField-0.1.0-x64-setup.exe` | `932d1a564648644d7b4a100d1e1f524d05673a1451bf30853c2069b6ff845e77` |

(Unsigned CI builds are rebuilt on every attempt, so hashes differ between attempts. Always test the hash listed in
that build's own `SHA256SUMS.txt`.)

| Gate | Status |
| --- | --- |
| Clean production build | ✅ |
| No unexpected networking | ✅ offline audit; **0** non-loopback sockets from the app and its 6 WebView2 processes during `/s` |
| No hidden scripts | ✅ (unchanged; see SECURITY.md §9) |
| No executable packer | ✅ |
| Conventional installer | ✅ WiX MSI and NSIS |
| Uninstall works | ✅ both installers; files, shortcuts and registration removed |
| Normal Windows metadata | ✅ Product/FileDescription "Soundwavian Field", CompanyName **Soundwave Machine Learning**, copyright, version 0.1.0, OriginalFilename `SoundwavianField.exe`, Comments "Soundwavian Field — Galactic Mandala Screensaver". CI asserts no placeholder text |
| Screensaver display name | ✅ string resource 1 = "Soundwavian Field" (what the Screen Saver dialog shows), asserted in CI |
| Defender scan clean | ✅ "found no threats" for all four files |
| `.scr` invocation behaviour (automated) | ✅ `/a`, `/p 0`, `/p <invalid>` exit; `/s` renders (mean luma ≈76, 92% of pixels lit) on a fresh WebView2 profile, keeps running, and ends on real mouse movement in 1.7–2.5 s (including 1.6 s of scripted movement). Helpers drain in 0.5 s |
| Application exits completely | ✅ |
| SHA-256 manifest, build metadata | ✅ (`build-info.json` records the publisher used) |
| Signing configuration documented | ✅ [SIGNING.md](SIGNING.md); publisher overridable via `SFIELD_PUBLISHER` |
| **Signed** with the publisher's certificate | ❌ **user-supplied certificate required** |
| **Physical Windows 10/11 gate** | ❌ **not yet performed.** Follow [PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md). Still unverified on real hardware: the live `/p` preview, the `/c` window inside the dialog, multi-monitor, mixed-DPI, real-GPU fps, reboot behaviour |

### Fixed in the hardening pass (verified in CI)

1. Placeholder publisher identity replaced with **Soundwave Machine Learning**; it can be overridden at release time to
   match the certificate subject.
2. The `.scr` now carries its display name. Without string resource 1, the Screen Saver dialog would have shown the
   file name "SoundwavianField".
3. **Dismissal reliability.** One CI run caught a first-launch case where the screensaver was still running 8 s
   after the mouse moved. Now the windows hide the instant dismissal is detected, a native last-input/cursor check
   dismisses even if the page stops responding, and a 2 s watchdog guarantees the process ends.
4. The smoke test's process-tree walk was confused by Windows PID reuse, reporting system processes as leftovers.
   Fixed with a creation-time check.

**Verdict:** don't call this publicly distribution-ready until it's built with `--signed` using your certificate and
[PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) passes on Windows 11 (and Windows 10 if available) for that
signed build.
