# Physical Windows test gate

A step-by-step checklist for testing Soundwavian Field on a real Windows PC.
No programming knowledge is needed. Do the whole list once on **Windows 11**,
and once on **Windows 10** if you have one.

**Rules**

- Tick a box only after you've actually seen the result. If something
  doesn't match, write down exactly what happened in **Notes**. Leave anything
  you couldn't test blank and say why. Never fill in a number you didn't read
  off the screen.
- Expected results are in *italics*.
- Keep a phone handy to photograph anything unexpected (warnings, error boxes).

| Record | Machine 1 | Machine 2 |
| --- | --- | --- |
| Tester / date | | |
| Windows edition + version (**Win+R** → `winver`) | | |
| PC model | | |
| Graphics card (overlay line `gpu …`, or Task Manager → Performance → GPU) | | |
| Monitors: count, resolution, scaling % (Settings → System → Display) | | |
| Installer tested (MSI or setup.exe) + its SHA-256 | | |
| Build commit (from `VERSION.txt`) | | |

---

## 1. Installation

- [ ] **Download.** Open the build's GitHub Actions run → **Artifacts** →
  `soundwavian-field-windows` → unzip it to a folder.
- [ ] **Verify SHA-256.** In that folder, Shift + right-click → *Open in
  Terminal* (or PowerShell) and run:
  `Get-FileHash .\SoundwavianField-*-x64.msi -Algorithm SHA256`
  *The hash matches that file's line in `SHA256SUMS.txt`, character for character.*
  Do the same for the `-setup.exe` if you test it.
- [ ] **Run the installer** (double-click it).
- [ ] **Record exactly what SmartScreen shows.** Copy the wording and note the
  buttons. An unsigned build is *expected* to show "Windows protected your
  PC". To continue, click **More info → Run anyway**.
- [ ] **Record the admin (UAC) prompt.** *Unsigned build: "Unknown
  publisher". Signed build: "Verified publisher: <certificate name>".*
- [ ] **Install directory.** *`C:\Program Files\Soundwavian Field\`
  containing `SoundwavianField.exe`, `SoundwavianField.scr` and
  `LICENSE-ASSETS.txt` (the setup.exe also adds `uninstall.exe`).*
- [ ] **Start Menu.** *Start → All apps shows **Soundwavian Field**.*
- [ ] **Uninstall entry.** *Settings → Apps → Installed apps lists
  "Soundwavian Field", version, publisher **Soundwave Machine Learning**.*

Notes:

## 2. First launch of the app

- [ ] Start **Soundwavian Field** from the Start Menu. *It opens full screen
  with no buttons or text. The image moves very slowly.*
- [ ] Move the mouse. *A small panel fades in at bottom-left.* Stop moving it.
  *About 3 s later the panel and the cursor both fade away.*
- [ ] Press **D**. *A small stats text appears top-right. Press D again to hide it.*
- [ ] Try **Space** (pause/resume), **→** (next image, slow blend), **M**,
  **P**, **R** (fade out and back in), **1–5** (presets), **F** and
  **Esc** (leave fullscreen). *Nothing flashes or jumps abruptly.*

Notes:

## 3. Screen saver

- [ ] Open Screen Saver Settings: **Win+R** → `control desk.cpl,,@screensaver` → OK.
- [ ] **Before doing anything else**, open the drop-down and note whether
  "Soundwavian Field" is listed. *It may not be yet: the installer keeps the
  `.scr` in Program Files and doesn't touch system folders.* Record what you see.
- [ ] Close the dialog. In the app, move the mouse → **Use as my screen
  saver** → **Screen Saver Settings…**. *The dialog opens with
  **Soundwavian Field** selected, shown with that name (not
  "SoundwavianField").*
- [ ] **Small preview.** *The little monitor picture in the dialog shows the
  moving field (the `/p` mode).*
- [ ] **Preview button.** *Full screen on the configured monitors. The cursor
  is hidden straight away.*
- [ ] **Mouse movement exits.** *A small movement ends it immediately.*
- [ ] **Keyboard exits.** Start Preview again, wait 3 s, press any letter key.
  *It ends.* Repeat with **Esc**, **Alt+Tab** and the **Windows key**. *Each ends it.*
- [ ] **No console windows.** *No black command-prompt or PowerShell window
  appears at any point, not even briefly.*
- [ ] **Real activation.** Set *Wait* to 1 minute → Apply → don't touch the PC
  for 70 s. *The screensaver starts by itself; moving the mouse ends it.*

Notes:

## 4. Settings window (`/c`)

- [ ] In Screen Saver Settings click **Settings…**. *A window titled
  "Soundwavian Field - Screen Saver Settings" opens, with the panel over a
  live field.*
- [ ] Choose a different preset, move a slider or two, set **Show on**, click **Done**.
- [ ] Click **Preview**. *The screensaver uses the preset you chose.*
- [ ] Reopen **Settings…**. *Your choices are still there.*
- [ ] After the reboot in section 9: *the choices are still there, and the
  screensaver starts normally (no corruption).*

Notes:

## 5. Displays

Tick only the setups you can actually test.

- [ ] **1080p, single monitor.** *Field fills the screen; no black bars or
  stretched image.*
- [ ] **Multiple monitors.** *With "Show on: Every display" each monitor shows
  its own field. With "Primary display only" the others are plain black. No
  taskbar or desktop shows through anywhere.*
- [ ] **Mixed resolutions** (e.g. 4K + 1080p). *Each monitor is fully covered.*
- [ ] **Scaling above 100%** (e.g. 150%). *Fully covered, sharp, nothing offset.*

Notes:

## 6. Performance

Use the app from the Start Menu, full screen, mouse still, **D** overlay
showing. Select each preset with keys **1–5** and leave it for **at least 2
minutes**. The overlay's second line then reads `<Preset>: avg X min Y over Ns`;
note those numbers once `over` passes 120 s. The first line shows the quality
tier (e.g. `high auto`).

| Preset | Avg fps | Min fps | Quality tier | Over (s) | Looked smooth? |
| --- | --- | --- | --- | --- | --- |
| 1 Stillness | | | | | |
| 2 Orbit | | | | | |
| 3 Deep Field | | | | | |
| 4 Ascension | | | | | |
| 5 Void | | | | | |

Also record the **GPU** line, the screen resolution and the monitor count
(from the overlay or the header table). *Target: average ≈60 (or your
monitor's refresh rate); minimum above 50.* If Auto steps the tier down during
the run, note when.

Notes:

## 7. System behaviour while the screen saver runs

Start the screensaver with **Preview** while Task Manager stays open on the
side (or check right after ending it). In Task Manager → **Details**,
right-click a column header → *Select columns* → add **Command line**. Our
WebView2 helpers are the `msedgewebview2.exe` rows whose command line
contains `com.soundwavian.field`.

- [ ] **Network.** Open **Resource Monitor** (**Win+R** → `resmon`) →
  **Network** → tick `SoundwavianField.scr` and our `msedgewebview2.exe`
  processes. *No entries under "TCP Connections" for them.*
- [ ] **No command windows / PowerShell.** *No `cmd.exe`, `conhost.exe` or
  `powershell.exe` appears while it starts or runs.*
- [ ] **CPU.** Note `SoundwavianField.scr` + helpers CPU %: ______.
  *Should be modest and steady, not pinned at 100% of a core.*
- [ ] **Memory.** Note the combined memory at 1 min ______ and at 20 min
  ______. *Roughly flat; no steady climb.*
- [ ] **After exit.** Move the mouse, wait 5 s. *No `SoundwavianField` and
  none of our `msedgewebview2.exe` rows remain.*

Notes:

## 8. First launch on a fresh profile

This rechecks the earlier first-launch focus bug, where the screensaver ended
by itself within a few seconds.

- [ ] Make sure no Soundwavian Field window is open. In File Explorer go to
  `%LOCALAPPDATA%` and delete the folder **`com.soundwavian.field`**. It holds
  only the WebView2 cache; your settings live elsewhere and stay.
- [ ] Screen Saver Settings → **Preview**. Don't touch anything for **30 s**.
  *It keeps running the whole time and only ends when you move the mouse.*

Notes:

## 9. Reboot

- [ ] Restart Windows. *It boots normally, with no error dialogs.*
- [ ] *Soundwavian Field does **not** start by itself after sign-in.*
- [ ] Task Manager → **Startup apps**: *no Soundwavian Field entry.*
- [ ] **Win+R** → `services.msc`: *no service with "Soundwavian" in its name.*
- [ ] **Win+R** → `taskschd.msc` → Task Scheduler Library: *no Soundwavian task.*
- [ ] Wait out the screensaver timeout. *It still starts, with your settings from section 4.*

Notes:

## 10. Uninstall

- [ ] Settings → Apps → Installed apps → Soundwavian Field → **Uninstall**.
  *Finishes without errors.*
- [ ] *`C:\Program Files\Soundwavian Field` is gone, and the Start Menu and
  desktop shortcuts are gone.*
- [ ] Reopen Screen Saver Settings and record what's selected. *Setup.exe
  uninstall: "(None)". MSI uninstall: the entry may linger; selecting it does
  nothing.*
- [ ] Restart once more. *Nothing related starts or complains.*

Notes:

---

## Sign-off

| | Machine 1 | Machine 2 |
| --- | --- | --- |
| All boxes ticked, or each exception explained? | | |
| Performance targets met on every preset? | | |
| Tester signature / date | | |

The build may be called **publicly distribution-ready** only when, for a
**signed** build: this gate passes on Windows 11 (and Windows 10 if
available), the automated CI gate is green for the same commit, and the
SHA-256s tested here match the release's `SHA256SUMS.txt`. Copy the results
into the *Current status* section of [RELEASE.md](RELEASE.md).
