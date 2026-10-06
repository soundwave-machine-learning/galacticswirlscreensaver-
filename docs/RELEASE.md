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
  → SHA-256 manifest (after signing), BUILD_INFO.txt, README-FIRST.txt, reports/build-info.json
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
pwsh scripts\windows\smoke-test.ps1 -Installer .\SoundwavianField-0.1.0.msi
pwsh scripts\windows\smoke-test.ps1 -Installer .\SoundwavianField-Setup-0.1.0.exe
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
| No hidden scripts | MSI `CustomAction` table + generated NSIS source reviewed (`dist/release/reports/installer-sources/`) | ✅ table dump in CI; review is manual |
| No executable packer | release profile; PE inspection | ✅ by construction |
| Conventional installer | Tauri's standard WiX MSI + NSIS | ✅ |
| Uninstall works | smoke test step 11 | ✅ CI (MSI + NSIS) |
| Normal Windows metadata | smoke test prints ProductName, CompanyName, FileDescription, OriginalFilename, version, copyright | ✅ CI (check the values) |
| Defender scan clean | `reports/defender-scan.txt` (MpCmdRun custom scan of every artifact) | ✅ CI; repeat for the signed build on the release machine |
| Clean-machine / VM install tested | [PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) on Windows 11 and 10, plus the smoke test on a fresh VM | ❌ manual |
| `.scr` invocation behaviour tested | unit tests + smoke test (`/a`, `/p` invalid and in a host window, `/c`, `/s` with mouse, keyboard and blocked network) + **manual** checks of the live preview and the *Settings…* button in the real Screen Saver dialog | ⚠️ partly manual |
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

**Version 0.1.0. Classification: RELEASE CANDIDATE.** The application is complete, the security re-audit passes,
the signing pipeline is prepared and the automated Windows release test is green. One automated check still fails,
though: keyboard dismissal in a *cold* session, the first keystroke into any WebView2 window since boot (see the
*Keyboard dismissal, cold session* row). That keeps the build below READY FOR SIGNING. No production code-signing
certificate has been supplied, and the physical Windows 10/11 validation hasn't been performed.

Evidence comes from CI run
[37396188157](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37396188157)
on commit `869dd7bb0abfd4a390299f8fb8b70fd5256866c6`, the last commit that changes application or test code. Later
commits change documentation only, and every push re-runs the same workflow. Each attempt was a fresh
`windows-latest` VM: Windows Server 2025 Datacenter 10.0.26100, WebView2 153.0.4234.48, software display adapter.
These are **unsigned DEVELOPMENT** builds, and each attempt rebuilds the artifacts, so hashes differ between runs.
Always compare against that build's own `SHA256SUMS.txt`.

Statuses: **PASS** observed and correct · **FAIL** observed and wrong · **BLOCKED** can't be done until a
prerequisite exists · **NOT RUN** not performed yet. CI results never count as physical results.

| Check | Status | Evidence |
| --- | --- | --- |
| Source tree clean | PASS | `git status` clean locally before commit; the CI build printed no uncommitted-changes warning, and `build-info.json` records `dirty: false` |
| Remote synchronization | PASS | local `HEAD` = `origin/claude/beautiful-goodall-ensaql` after push (`git ls-remote`) |
| Frontend production build | PASS | `npm run build`: type-check, Vite and the offline audit, in CI (web job and Windows job) |
| Rust compile | PASS | `cargo build --release` (x86_64-pc-windows-msvc, rustc 1.99.0); native unit tests pass |
| Clippy | PASS | `cargo clippy --release -- -D warnings`: no warnings |
| MSI creation | PASS | `SoundwavianField-0.1.0.msi` (WiX) produced |
| Setup EXE creation | PASS | `SoundwavianField-Setup-0.1.0.exe` (NSIS) produced |
| SCR creation | PASS | `SoundwavianField.scr` staged and installed by both installers |
| Product identity | PASS | ProductName/FileDescription "Soundwavian Field", Comments "Soundwavian Field — Galactic Mandala Screensaver…", OriginalFilename `SoundwavianField.exe`, version 0.1.0, asserted for the installed `.exe` and `.scr` |
| Publisher identity | PASS | CompanyName and copyright "Soundwave Machine Learning"; no placeholder text (asserted). Must still match the certificate subject when signing |
| Screensaver display name | PASS | string resource 1 = "Soundwavian Field" (asserted) |
| /s | PASS | renders full screen (mean luma ≈76), keeps running; only `SoundwavianField` + `msedgewebview2.exe` processes |
| /c | PASS | opens "Soundwavian Field - Screen Saver Settings", closes cleanly in 0.3–0.4 s, no leftovers. Inside the real dialog: see *Screen Saver Settings button* |
| /p | PASS | in a stand-in host window: child window created, field drawn (luma ≈71), exits 0.1 s after the host closes; `/p 0` and `/p 999999` exit. Inside the real dialog: see *Screen Saver dialog preview* |
| /a | PASS | exits on its own |
| Mouse dismissal | PASS | process gone 0.06–0.50 s after real cursor movement (cold-profile and offline runs, both installers); limits 1.5 s hand-back, 3 s exit |
| Keyboard dismissal | PASS | in a session where a WebView2 window has already had keyboard input (the test types D into the app first): process gone 0.14 s (MSI) and 0.03 s (setup.exe) after key-down, measured from Windows' input timestamp |
| Keyboard dismissal, cold session | FAIL | first keystroke into any WebView2 window since boot, ending the screen saver. On six fresh CI VMs: 0.77, 1.89, 1.11, 2.63, 5.01 and 3.86 s from key-down to exit (runs [37388449324](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37388449324), [37389815993](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37389815993), [37391161263](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37391161263), [37392425603](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37392425603), [37393685918](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37393685918), [37394965804](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37394965804)), over the 1.5 s hand-back limit in 4 of 6. Detection takes 0.1–0.45 s; the rest is the process being unable to run or finish terminating (cause not determined). Not yet checked on real hardware: physical gate §9 |
| First-launch behavior | PASS | `/s` and the app on a deleted (cold) WebView2 profile render and keep running until input |
| Process termination | PASS | no process of the tree remains (PID-reuse-safe check) and no window remains after every mode |
| MSI install | PASS | silent `msiexec` install, exit code 0; `.exe` and `.scr` present in `C:\Program Files\Soundwavian Field\` |
| MSI uninstall | PASS | exit code 0; files, Start Menu and desktop shortcuts removed; no process left |
| EXE install | PASS | silent NSIS install, exit code 0; `.exe` and `.scr` present in `C:\Program Files\Soundwavian Field\` |
| EXE uninstall | PASS | exit code 0; files, Start Menu and desktop shortcuts removed; no process left |
| No app networking | PASS | offline audit; **0** sockets from the app and its WebView2 processes during `/s` and the app; `/s` works with outbound traffic firewalled for the app and every `msedgewebview2.exe`; no networking DLL imported |
| No services | PASS | service diff before/after install and after uninstall; MSI `ServiceInstall` table absent |
| No scheduled tasks | PASS | task diff before/after install and after uninstall |
| No startup persistence | PASS | Run/RunOnce keys and Startup folders unchanged |
| No runtime downloads | PASS | no updater, no HTTP client compiled in, WebView2 install mode `skip` (audited) |
| No packer | PASS | PE sections `.text .rdata .data .pdata .rsrc .reloc` only; 23 system DLL imports |
| Defender | PASS | MpCmdRun custom scan of the 4 artifacts: "no threats found", threat count 0 (`reports/defender-scan.txt`). Not yet repeated on the signed build |
| SHA-256 manifest | PASS | `SHA256SUMS.txt`, generated as the last step after any signing |
| Build-info manifest | PASS | `BUILD_INFO.txt` + `reports/build-info.json` (commit, timestamp, CI run, toolchain, signed flag, Defender result; no secrets) |
| Signing pipeline readiness | PASS | audited sequence in [SIGNING.md](SIGNING.md); in CI, `release.mjs --signed` and `sign.mjs` both refuse (exit 1) with no certificate. The positive signed path hasn't been run, because no certificate exists |
| Actual Authenticode signing | BLOCKED | no production code-signing certificate supplied; all artifacts are `NotSigned` |
| Signature verification | BLOCKED | depends on actual signing |
| Windows 10 physical test | NOT RUN | [PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) |
| Windows 11 physical test | NOT RUN | [PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) |
| Screen Saver dialog preview | NOT RUN | physical gate §3 |
| Screen Saver Settings button | NOT RUN | physical gate §4 |
| Reboot persistence behavior | NOT RUN | physical gate §9 |
| Single-monitor real GPU test | NOT RUN | physical gate §5 (CI has only a software adapter) |
| Multi-monitor test | NOT RUN | physical gate §5 |
| Mixed-DPI test | NOT RUN | physical gate §5 |
| Real hardware FPS | NOT RUN | physical gate §6 (**D** overlay average per preset) |
| Real hardware minimum FPS | NOT RUN | physical gate §6 (**D** overlay minimum per preset) |

**Remaining blockers:**

1. Keyboard dismissal in a cold session (FAIL above). Check it on a real Windows 11 PC first (physical gate §9). If
   it reproduces there, it needs a fix before signing; if it doesn't, it's an artefact of the CI VMs, and the row
   can be re-assessed with that evidence.
2. A production code-signing certificate, then a `signed: true` build that verifies.
3. The physical gate on Windows 11 (and Windows 10 if available) for that signed build.

Only after all three may a build be classified as *DISTRIBUTION READY*.

### Fixed in the hardening pass (verified in CI)

1. Placeholder publisher identity replaced with **Soundwave Machine Learning**; it can be overridden at release time to
   match the certificate subject.
2. The `.scr` now carries its display name. Without string resource 1, the Screen Saver dialog would have shown the
   file name "SoundwavianField".
3. **Dismissal reliability.** One CI run caught a first-launch case where the screensaver was still running 8 s
   after the mouse moved. A native last-input/cursor check now dismisses even if the page stops responding.
4. **Slow keyboard dismissal, first round.** The new keyboard test measured 3.6–12.8 s from keypress to exit, even
   though Windows had registered the key and the screensaver owned the foreground. Shutdown now runs once, cloaks
   the windows through DWM (`DWMWA_CLOAK`) and hides them without waiting on the UI thread, and a watchdog ends the
   process with `TerminateProcess`. This was green in one run but not reliable; see items 7 and 8.
5. The smoke test's process-tree walk was confused by Windows PID reuse, reporting system processes as leftovers.
   Fixed with a creation-time check.
6. Release layout: `SoundwavianField-Setup-<ver>.exe`, `SoundwavianField-<ver>.msi`, `.scr`, `.exe`,
   `SHA256SUMS.txt`, `BUILD_INFO.txt`, `README-FIRST.txt`, with reports in `reports/`. Diagnostics (**D** / **C**,
   local clipboard only) added.
7. **Test-timing robustness.** Run
   [37381578728](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37381578728)
   (`a3fffce`) failed the MSI test's keyboard timing with "18.28 s". In that run the runner itself was starved (23 s
   between two consecutive test statements), so the test's own stopwatch couldn't be trusted. Latencies are now
   measured from Windows' own input timestamp (`GetLastInputInfo`) and the process's exit time (`Process.ExitTime`,
   with a fallback when Windows doesn't report it). Runner stalls are logged. Thresholds are unchanged: 1.5 s
   hand-back, 3 s exit, 10 s drain.
8. **Slow keyboard dismissal, measured and fixed.** With exact timestamps the slowness was real: 3.6 s and 9.4 s from
   key-down to exit (run [37383725710](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37383725710)),
   while mouse dismissal stayed under 1 s. An opt-in trace (`SFIELD_TRACE`, written only when the release test sets
   it) showed the key was detected within about 110–220 ms. After that, a watchdog thread created at that moment
   started late or not at all, a window-cloak call blocked for 2.1 s, and termination took up to 2.4 s
   (runs [37385350139](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37385350139),
   [37386858463](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37386858463)).
   The exact cause inside the process is **not determined**. A snapshot of loaded DLLs before and after the key
   showed no new modules, so the hypothesis that the keystroke triggers DLL loading isn't confirmed.
   - `bebee1d`: the watchdog thread is created at startup and parked, so shutdown only wakes it. In `/s` mode, with
     nothing to save, it terminates the process immediately.
   - `2479366`: `/s` no longer also starts the normal exit. Run
     [37389815993](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37389815993)
     showed that racing the termination. The dying process panicked ("failed to spawn thread"), and one keyboard
     hand-back took 1.89 s.

   Since then, run [37391161263](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37391161263)
   measured keyboard 0.18–1.11 s and mouse 0.27–1.29 s from input to exit, on both installers. On these loaded CI
   VMs the remaining variation is in how long Windows takes to finish terminating the process. Real hardware is
   checked by the physical gate (§3).

9. **Cold-session keyboard dismissal (open).** After the fixes above, the keyboard case was slow only in whichever
   test sent the VM's first keystroke into a WebView2 window: always the MSI test, which runs first. The setup.exe
   test on the same VM measured 0.03–0.22 s in every run. What was ruled out:
   - pressing Shift into the test console first didn't help (run [37393685918](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37393685918), 5.01 s);
   - no new process starts around the input (run [37394965804](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37394965804));
   - the keystroke loads no new DLLs into the process (run [37391161263](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37391161263)).

   Typing two keys into the app window first made the MSI case fast (0.14 s, run
   [37396188157](https://github.com/soundwave-machine-learning/galacticswirlscreensaver-/actions/runs/37396188157)). The key-up lag on those first app keystrokes was only 110–125 ms, so input
   itself isn't frozen; the delay appears when the process then ends. The release test now includes those app
   keystrokes, which also cover keyboard handling in app mode. The cold case is kept as a separate FAIL row rather
   than hidden by the test order.

**Verdict:** don't call this publicly distribution-ready until it's built with `--signed` using your certificate and
[PHYSICAL_WINDOWS_GATE.md](PHYSICAL_WINDOWS_GATE.md) passes on Windows 11 (and Windows 10 if available) for that
signed build.
