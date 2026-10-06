<#
.SYNOPSIS
  Install / run / uninstall release test for Soundwavian Field on Windows.

.DESCRIPTION
  Intended for a clean Windows 10/11 VM, and run automatically on the CI
  runner. Run from an elevated PowerShell: the installers are per-machine
  (Program Files), and the offline test adds and removes firewall rules.

  Sections:
    [1]  install
    [2]  installed files + identity (version info, screen saver display name)
    [3]  persistence after install (services, tasks, Run keys, Startup)
    [4]  /a and /p with an invalid HWND exit on their own
    [5]  /p <HWND>: preview renders inside a real host window, exits with it
    [6]  /c: settings window opens and closes cleanly
    [7]  app (.exe) launch, cold WebView2 profile
    [8]  /s first launch: renders, child processes, sockets, mouse dismissal
    [9]  /s keyboard dismissal
    [10] /s with outbound network blocked for the app and WebView2
    [11] uninstall + cleanup

  Every check prints PASS or FAIL. Things only a person can judge (for
  example whether the settings dialog looks right) print PHYSICAL and are
  never counted as passed. The report is written to -ReportDir as
  smoke-test-<msi|nsis>.txt.

.EXAMPLE
  pwsh -File scripts\windows\smoke-test.ps1 -Installer dist\release\SoundwavianField-Setup-0.1.0.exe
#>
param(
  [Parameter(Mandatory)] [string] $Installer,
  [int] $RunSeconds = 15,
  [string] $ReportDir
)

$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path $Installer).Path
$kind = if ($Installer -like '*.msi') { 'msi' } else { 'nsis' }
if (-not $ReportDir) { $ReportDir = Join-Path (Split-Path $Installer) 'reports' }
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$report = Join-Path $ReportDir "smoke-test-$kind.txt"
$lines = [System.Collections.Generic.List[string]]::new()
$failures = 0
function Log([string] $m) { Write-Host $m; $lines.Add($m) }
function Check([bool] $ok, [string] $m) {
  if ($ok) { Log "  PASS  $m" } else { Log "  FAIL  $m"; $script:failures++ }
}
function Physical([string] $m) { Log "  PHYSICAL  $m  (needs a person - see docs/PHYSICAL_WINDOWS_GATE.md)" }
function NotRun([string] $m) { Log "  NOT RUN  $m" }

$expectedVersion = if ([IO.Path]::GetFileName($Installer) -match '(\d+\.\d+\.\d+)') { $Matches[1] } else { $null }
$installDir = Join-Path $env:ProgramFiles 'Soundwavian Field'
$exe = Join-Path $installDir 'SoundwavianField.exe'
$scr = Join-Path $installDir 'SoundwavianField.scr'
$profileDir = Join-Path $env:LOCALAPPDATA 'com.soundwavian.field'

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace SField -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr LoadLibraryExW(string path, System.IntPtr file, uint flags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern int LoadStringW(System.IntPtr module, uint id, System.Text.StringBuilder buffer, int max);
[DllImport("kernel32.dll")]
public static extern bool FreeLibrary(System.IntPtr module);
[DllImport("user32.dll")]
public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern System.IntPtr FindWindowExW(System.IntPtr parent, System.IntPtr after, string cls, string title);
[DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
[DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
public static uint LastInputTick() { var i = new LASTINPUTINFO(); i.cbSize = 8; GetLastInputInfo(ref i); return i.dwTime; }
public static uint MsSinceLastInput() { var i = new LASTINPUTINFO(); i.cbSize = 8; GetLastInputInfo(ref i); return unchecked((uint)Environment.TickCount - i.dwTime); }
public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
[DllImport("dwmapi.dll")]
public static extern int DwmGetWindowAttribute(System.IntPtr hwnd, int attr, out int value, int size);
public static bool IsCloaked(System.IntPtr hwnd) { int v; return DwmGetWindowAttribute(hwnd, 14, out v, 4) == 0 && v != 0; }
'@

# ---------------------------------------------------------------------------
# Helpers

function Get-PersistenceSnapshot {
  $runKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
  )
  $run = foreach ($k in $runKeys) {
    if (Test-Path $k) { (Get-Item $k).Property | ForEach-Object { "$k\$_" } }
  }
  $startupDirs = @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))
  [pscustomobject]@{
    Services = @(Get-Service | ForEach-Object Name)
    Tasks    = @(Get-ScheduledTask | ForEach-Object { "$($_.TaskPath)$($_.TaskName)" })
    Run      = @($run)
    Startup  = @($startupDirs | Where-Object { $_ -and (Test-Path $_) } | ForEach-Object { Get-ChildItem $_ -Force } | ForEach-Object FullName)
  }
}

function Compare-Set($before, $after) { @($after | Where-Object { $before -notcontains $_ }) }

# CreateProcess semantics with an exact argument string - the way Windows
# starts a screen saver. (Start-Process uses ShellExecute, whose "open" verb
# for .scr files is `"%1" /S`, which would replace the arguments under test.)
function Start-Direct([string] $file, [string] $arguments, [string] $tracePath) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new($file, $arguments)
  $psi.UseShellExecute = $false
  # Opt-in app diagnostics (input watcher + shutdown events), see main.rs trace().
  if ($tracePath) { Remove-Item $tracePath -ErrorAction SilentlyContinue; $psi.EnvironmentVariables['SFIELD_TRACE'] = $tracePath }
  [System.Diagnostics.Process]::Start($psi)
}

# Mean luminance of a screen rectangle (default: primary screen).
function Measure-Region([System.Drawing.Rectangle] $r, [string] $savePath) {
  if ($r.IsEmpty) { $r = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds }
  $bmp = [System.Drawing.Bitmap]::new($r.Width, $r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Location, [System.Drawing.Point]::Empty, $r.Size)
  $sum = 0.0; $n = 0; $lit = 0
  $step = [math]::Max(2, [int]([math]::Min($r.Width, $r.Height) / 96))
  for ($y = 0; $y -lt $r.Height; $y += $step) {
    for ($x = 0; $x -lt $r.Width; $x += $step) {
      $c = $bmp.GetPixel($x, $y)
      $l = 0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B
      $sum += $l; $n++; if ($l -gt 24) { $lit++ }
    }
  }
  if ($savePath) { $bmp.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png) }
  $g.Dispose(); $bmp.Dispose()
  [pscustomobject]@{ Width = $r.Width; Height = $r.Height; MeanLuma = [math]::Round($sum / [math]::Max(1, $n), 1); LitFraction = [math]::Round($lit / [math]::Max(1, $n), 3) }
}

function Get-ProcessTree([int] $rootId) {
  # ParentProcessId is never cleared and Windows reuses PIDs: a system process
  # whose long-dead parent had our PID would look like our child. A real child
  # is always created after its parent, so require that.
  $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate)
  $byId = @{}
  foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void] $ids.Add($rootId)
  do {
    $added = $false
    foreach ($p in $all) {
      $parentId = [int]$p.ParentProcessId
      if ($ids.Contains($parentId) -and -not $ids.Contains([int]$p.ProcessId)) {
        $parent = $byId[$parentId]
        if ($parent -and $p.CreationDate -ge $parent.CreationDate) { [void] $ids.Add([int]$p.ProcessId); $added = $true }
      }
    }
  } while ($added)
  @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
}

# Non-loopback sockets owned by any process in the tree.
function Get-TreeSockets($tree) {
  $ids = @($tree.ProcessId)
  @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notin @('127.0.0.1', '::1', '0.0.0.0', '::') } | ForEach-Object { "TCP pid $($_.OwningProcess) -> $($_.RemoteAddress):$($_.RemotePort)" }) +
  @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess -and $_.LocalAddress -notin @('127.0.0.1', '::1') } | ForEach-Object { "UDP pid $($_.OwningProcess) $($_.LocalAddress):$($_.LocalPort)" })
}

# After the main process ends, every process it started must go too.
function Test-Drained($tree, [string] $label) {
  $keys = @($tree | ForEach-Object { "$($_.ProcessId)@$($_.CreationDate.Ticks)" })
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  do {
    Start-Sleep -Milliseconds 500
    $left = @(Get-CimInstance Win32_Process | Where-Object { $keys -contains "$($_.ProcessId)@$($_.CreationDate.Ticks)" })
  } while ($left.Count -gt 0 -and $sw.Elapsed.TotalSeconds -lt 15)
  $windows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Soundwavian Field*' })
  Check ($left.Count -eq 0 -and $sw.Elapsed.TotalSeconds -le 10) "$label`: no processes remain (drained in $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s) $(if ($left.Count) { '-> ' + ($left.Name -join ', ') })"
  Check ($windows.Count -eq 0) "$label`: no Soundwavian Field window remains on screen"
}

function Test-ChildNames($tree, [string] $label) {
  $others = @($tree | Where-Object { $_.Name -notin @('SoundwavianField.scr', 'SoundwavianField.exe', 'msedgewebview2.exe') })
  Check ($others.Count -eq 0) "$label`: only SoundwavianField + msedgewebview2.exe processes (no cmd/conhost/powershell) $(if ($others.Count) { '-> ' + ($others.Name -join ', ') })"
}

function Wait-WindowTitle($proc, [string] $pattern, [int] $seconds) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $seconds) {
    $proc.Refresh()
    if ($proc.HasExited) { return $null }
    if ($proc.MainWindowTitle -like $pattern) { return $proc.MainWindowTitle }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

# Returns when Windows registered the key-down, from the session's own input
# timestamp, so a stalled test runner can't distort the measured latency.
# Also records in $script:keyGapMs how long after the key-down Windows
# registered the key-up (sent 60 ms later); far more than that means input
# processing stalled on this machine.
function Press-Key([byte] $vk = 0x41) {
  $prevTick = [SField.Native]::LastInputTick()
  [SField.Native]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)   # down ('A' by default)
  $downTick = [SField.Native]::LastInputTick()
  $downAt = [DateTime]::Now.AddMilliseconds(-[double][SField.Native]::MsSinceLastInput())
  Start-Sleep -Milliseconds 60
  [SField.Native]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)   # up
  # (-1: the key-down itself was not registered yet when read back)
  $script:keyGapMs = if ($downTick -ne $prevTick) { [long][SField.Native]::LastInputTick() - [long]$downTick } else { -1 }
  return $downAt
}

# Run /s, verify it renders, has only expected children and no sockets, then
# dismiss it with the given input and verify a prompt, complete exit.
function Test-ScreenSaver([string] $label, [string] $dismiss, [bool] $coldProfile, [int] $seconds) {
  if ($coldProfile) { Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue }
  $tracePath = Join-Path $ReportDir "trace-$kind-$($label -replace '\W','-').txt"
  $proc = Start-Direct $scr '/s' $tracePath
  $sockets = @(); $tree = @(); $shot = $null
  for ($i = 0; $i -lt $seconds; $i++) {
    Start-Sleep -Seconds 1
    if ($proc.HasExited) { break }
    $tree = Get-ProcessTree $proc.Id
    $sockets += Get-TreeSockets $tree
    if ($i -eq [math]::Min(10, $seconds - 2)) {
      try { $shot = Measure-Region ([System.Drawing.Rectangle]::Empty) (Join-Path $ReportDir "screensaver-$kind-$($label -replace '\W','-').png") } catch { Log "  (screen capture unavailable: $_)" }
    }
  }
  $why = if (-not $proc.HasExited) { 'running' } elseif ($proc.ExitCode -eq 2) { 'exit 2 = another window took the foreground' } else { "exit $($proc.ExitCode)" }
  Check (-not $proc.HasExited) "$label`: keeps running until dismissed ($why)"
  if ($shot) {
    Log "  screen $($shot.Width)x$($shot.Height): mean luma $($shot.MeanLuma), lit fraction $($shot.LitFraction)"
    Check ($shot.MeanLuma -gt 8) "$label`: the field is visibly rendered on screen"
  }
  Log "  process tree: $(($tree | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ')"
  Test-ChildNames $tree $label
  $uniq = @($sockets | Sort-Object -Unique)
  Check ($uniq.Count -eq 0) "$label`: no network sockets opened by the app or its WebView2 processes $(if ($uniq.Count) { '-> ' + ($uniq -join '; ') })"
  if (-not $proc.HasExited) {
    # What the user experiences is the screen being handed back: the app hides
    # its windows the moment input is detected, then exits (1 s watchdog).
    $proc.Refresh()
    $hwndBefore = $proc.MainWindowHandle
    $hadWindow = $hwndBefore -ne [IntPtr]::Zero
    $moves = @(@(200, 200), @(260, 240), @(420, 380), @(600, 500))
    $mi = 0; $nextMove = 0; $pressed = $false; $released = $null; $inputAt = $null; $exitSeen = $null
    $procsBefore = @(Get-Process | ForEach-Object { $_.Id })
    $fgPid = [SField.Native]::ForegroundPid()
    $tickBefore = [SField.Native]::LastInputTick()
    Log "  before input: foreground window owned by pid $fgPid ($(if ($fgPid -eq $proc.Id) { 'the screen saver' } else { 'another process' })); last-input tick $tickBefore"
    # Latencies are measured from the moment of input to the observed hide and to
    # the process's own exit time (recorded by Windows). The polling loop only
    # provides upper bounds, so a stall of the test runner itself shows up as
    # a large loop gap (logged) instead of as app latency.
    $sw = [System.Diagnostics.Stopwatch]::StartNew(); $maxGap = 0.0; $lastIter = 0.0
    while ($sw.Elapsed.TotalSeconds -lt 15) {
      $t = $sw.Elapsed.TotalSeconds; $maxGap = [math]::Max($maxGap, $t - $lastIter); $lastIter = $t
      if ($dismiss -eq 'mouse' -and $mi -lt $moves.Count -and $sw.ElapsedMilliseconds -ge $nextMove) {
        # Cursor moves don't update the last-input time, so time the first move
        # here - just before it, so the measured latency is never too small.
        if ($null -eq $inputAt) { $inputAt = [DateTime]::Now }
        [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new($moves[$mi][0], $moves[$mi][1]); $mi++; $nextMove += 400
      }
      if ($dismiss -eq 'keyboard' -and -not $pressed) {
        $inputAt = Press-Key; $pressed = $true
        $tickAfter = [SField.Native]::LastInputTick()
        Log "  injected key: last-input tick $tickBefore -> $tickAfter ($(if ($tickAfter -ne $tickBefore) { 'registered by Windows' } else { 'NOT registered - synthetic input did not reach this session' })); key-up registered $script:keyGapMs ms after key-down"
      }
      $proc.Refresh()
      # Handed back = hidden, cloaked by DWM (off screen at composition level), or exited.
      if ($null -eq $released -and -not $proc.HasExited -and $hadWindow -and ($proc.MainWindowHandle -eq [IntPtr]::Zero -or [SField.Native]::IsCloaked($hwndBefore))) {
        $released = ([DateTime]::Now - $inputAt).TotalSeconds
      }
      if ($proc.HasExited) { $exitSeen = [DateTime]::Now; break }
      Start-Sleep -Milliseconds 50
    }
    $ok = $proc.HasExited
    # Any process that appeared system-wide around the input (diagnostic only).
    $newProcs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $procsBefore -notcontains $_.Id -and $_.ProcessName -ne 'msedgewebview2' } |
      ForEach-Object { $t = try { [math]::Round(($_.StartTime - $inputAt).TotalSeconds, 2) } catch { '?' }; "$($_.ProcessName)#$($_.Id)@$t s" })
    Log "  processes started around the input: $(if ($newProcs.Count) { $newProcs -join ', ' } else { 'none' })"
    if ($maxGap -gt 0.5) { Log ("  note: the test runner itself stalled for up to {0:N1} s between polls; latencies below use Windows' timestamps" -f $maxGap) }
    if ($ok) {
      # ExitTime is exact when Windows provides it; otherwise use when the exit was observed.
      $exitAt = try { $proc.ExitTime } catch { $null }
      if ($null -eq $exitAt -or $exitAt.Year -lt 2000) { $exitAt = $exitSeen }
      $exitAfter = ($exitAt - $inputAt).TotalSeconds
      # The process exiting hands the screen back too; its exit time is exact.
      if ($null -eq $released -or $exitAfter -lt $released) { $released = $exitAfter }
      $secs = [math]::Round($exitAfter, 2)
    }
    if ($inputAt) { Log "  input at unix ms $([DateTimeOffset]::new($inputAt).ToUnixTimeMilliseconds())$(if ($ok) { "; process exit at unix ms $([DateTimeOffset]::new($exitAt).ToUnixTimeMilliseconds())" })" }
    Check $ok "$label`: $dismiss input ends the screen saver ($(if ($ok) { "process exited $secs s after the input, code $($proc.ExitCode)" } else { 'still running after 15 s' }))"
    if ($null -ne $released) {
      $r = [math]::Round($released, 2)
      Check ($released -le 1.5) "$label`: screen handed back within 1.5 s of the input (window hidden after $r s$(if (-not $hadWindow) { '; measured as process exit' }))"
    } else {
      Check $false "$label`: screen handed back (window never hid)"
    }
    if ($ok) { Check ($secs -le 3) "$label`: process gone within 3 s of the input (detection + termination; took $secs s)" }
  }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }
  if (Test-Path $tracePath) { Get-Content $tracePath | ForEach-Object { Log "    trace: $_" } }
  Test-Drained $tree $label
}

# ---------------------------------------------------------------------------

$testStart = Get-Date
Log "Soundwavian Field release test - $kind - $(Get-Date -Format o)"
Log "Installer: $Installer"
Log "SHA-256:   $((Get-FileHash $Installer -Algorithm SHA256).Hash)"
Log "OS:        $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).Version)"
$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
Log "WebView2:  $(if ($wv) { $wv.pv } else { 'not found in HKLM (may be per-user)' })"
Log "Display:   $([System.Windows.Forms.Screen]::AllScreens.Count) screen(s), primary $([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Size)"

Log "`n[1] Install"
$before = Get-PersistenceSnapshot
if ($kind -eq 'msi') {
  $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$Installer`"", '/qn', '/norestart', '/l*v', "`"$report.install.log`"") -Wait -PassThru
} else {
  $p = Start-Process $Installer -ArgumentList '/S' -Wait -PassThru
}
Check ($p.ExitCode -eq 0) "installer exit code $($p.ExitCode)"
Check (Test-Path $exe) "app installed at $exe"
Check (Test-Path $scr) "screen saver installed at $scr"

Log "`n[2] Installed files and identity"
Get-ChildItem $installDir -Recurse -File | ForEach-Object {
  $sig = Get-AuthenticodeSignature $_.FullName
  Log ("  {0,-34} {1,10:N0} bytes  sig={2}  {3} {4}" -f $_.Name, $_.Length, $sig.Status, $_.VersionInfo.FileDescription, $_.VersionInfo.FileVersion)
}
$pe = Get-ChildItem $installDir -Recurse -File -Include *.exe, *.dll, *.scr, *.sys
Log "  executables/DLLs: $($pe.Name -join ', ')"
Check (@($pe | Where-Object { $_.Extension -in '.dll', '.sys' }).Count -eq 0) 'no DLLs or drivers installed'
if ($env:SFIELD_EXPECT_SIGNED -eq 'true') {
  foreach ($f in @($pe) + @(Get-Item $Installer)) {
    $sig = Get-AuthenticodeSignature $f.FullName
    Check ($sig.Status -eq 'Valid') "$($f.Name) has a valid Authenticode signature ($($sig.Status); $($sig.SignerCertificate.Subject))"
  }
} else {
  Log '  (unsigned build: Authenticode checks not applicable)'
}
if (Test-Path $exe) {
  foreach ($file in @($exe, $scr)) {
    $vi = (Get-Item $file).VersionInfo
    $name = Split-Path $file -Leaf
    Log "  $name version info: Product='$($vi.ProductName)' Company='$($vi.CompanyName)' Description='$($vi.FileDescription)' Comments='$($vi.Comments)' Original='$($vi.OriginalFilename)' FileVersion=$($vi.FileVersion) ProductVersion=$($vi.ProductVersion) Copyright='$($vi.LegalCopyright)'"
    $expectedCompany = if ($env:SFIELD_PUBLISHER) { $env:SFIELD_PUBLISHER } else { 'Soundwave Machine Learning' }
    Check ($vi.ProductName -eq 'Soundwavian Field') "$name ProductName = 'Soundwavian Field'"
    Check ($vi.CompanyName -eq $expectedCompany) "$name CompanyName = '$expectedCompany'"
    Check ($vi.FileDescription -eq 'Soundwavian Field') "$name FileDescription = 'Soundwavian Field'"
    Check ($vi.Comments -like '*Galactic Mandala Screensaver*') "$name Comments carry the product description"
    Check ($vi.OriginalFilename -eq 'SoundwavianField.exe') "$name OriginalFilename = 'SoundwavianField.exe'"
    if ($expectedVersion) { Check ($vi.ProductVersion -eq $expectedVersion -and $vi.FileVersion -eq $expectedVersion) "$name version = $expectedVersion" }
    Check (("$($vi.CompanyName) $($vi.LegalCopyright) $($vi.Comments)") -notmatch 'placeholder') "$name has no placeholder publisher text"
  }
  # The Screen Saver Settings dialog lists a .scr by its string resource 1.
  $mod = [SField.Native]::LoadLibraryExW($scr, [IntPtr]::Zero, 0x22)  # DATAFILE | IMAGE_RESOURCE
  $sb = [System.Text.StringBuilder]::new(256)
  $n = if ($mod -ne [IntPtr]::Zero) { [SField.Native]::LoadStringW($mod, 1, $sb, 256) } else { 0 }
  if ($mod -ne [IntPtr]::Zero) { [void][SField.Native]::FreeLibrary($mod) }
  Check ($n -gt 0 -and $sb.ToString() -eq 'Soundwavian Field') "screen saver display name (string resource 1) = '$($sb.ToString())'"
  $same = (Get-FileHash $exe).Hash -eq (Get-FileHash $scr).Hash
  Log "  exe/scr identical bytes: $same (the bundler stamps an installer-type marker into its copy of the exe)"
}

Log "`n[3] Persistence after install"
$after = Get-PersistenceSnapshot
foreach ($kindName in 'Services', 'Tasks', 'Run', 'Startup') {
  $new = Compare-Set $before.$kindName $after.$kindName
  Check ($new.Count -eq 0) "no new $kindName $(if ($new.Count) { '-> ' + ($new -join '; ') })"
}

Log "`n[4] /a and /p with an invalid window handle"
foreach ($a in @('/a', '/p 0', '/p 999999')) {
  $proc = Start-Direct $scr $a
  $exited = $proc.WaitForExit(10000)
  if (-not $exited) { Stop-Process -Id $proc.Id -Force }
  Check $exited "'$a' exits on its own"
}

Log "`n[5] /p <HWND> - preview inside a host window (stand-in for the Screen Saver dialog)"
Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Preview host'
$form.FormBorderStyle = 'FixedToolWindow'
$form.StartPosition = 'Manual'
$form.Location = [System.Drawing.Point]::new(40, 40)
$form.ClientSize = [System.Drawing.Size]::new(320, 240)
$form.BackColor = [System.Drawing.Color]::Black
$form.TopMost = $true
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
$hostHwnd = $form.Handle.ToInt64()
$proc = Start-Direct $scr "/p $hostHwnd"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt 14 -and -not $proc.HasExited) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
Check (-not $proc.HasExited) "/p keeps running while its host window exists"
# [NullString]::Value - a plain $null would be marshalled as "" (an empty class name).
$child = [SField.Native]::FindWindowExW($form.Handle, [IntPtr]::Zero, [NullString]::Value, [NullString]::Value)
$childPid = 0
if ($child -ne [IntPtr]::Zero) { [void][SField.Native]::GetWindowThreadProcessId($child, [ref]$childPid) }
Check ($child -ne [IntPtr]::Zero -and $childPid -eq $proc.Id) "/p places a child window inside the host (owner pid $childPid)"
$clientOrigin = $form.PointToScreen([System.Drawing.Point]::Empty)
$shot = Measure-Region ([System.Drawing.Rectangle]::new($clientOrigin, $form.ClientSize)) (Join-Path $ReportDir "preview-$kind.png")
Log "  host client area: mean luma $($shot.MeanLuma), lit fraction $($shot.LitFraction) (host background is black)"
Check ($shot.MeanLuma -gt 8) '/p draws the field inside the host window'
$previewTree = Get-ProcessTree $proc.Id
Test-ChildNames $previewTree '/p'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$form.Close(); $form.Dispose()
[System.Windows.Forms.Application]::DoEvents()
$gone = $proc.WaitForExit(8000)
Check $gone "/p exits when its host window closes ($(if ($gone) { "after $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s" } else { 'still running' }))"
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }
Test-Drained $previewTree '/p'
Physical 'live preview in the real Windows Screen Saver Settings dialog'

Log "`n[6] /c - settings window"
$proc = Start-Direct $scr '/c'
$title = Wait-WindowTitle $proc '*Screen Saver Settings*' 20
Check ($null -ne $title) "/c opens a window titled '$title'"
Start-Sleep -Seconds 3
$cTree = Get-ProcessTree $proc.Id
Test-ChildNames $cTree '/c'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
[void]$proc.CloseMainWindow()
$closed = $proc.WaitForExit(10000)
Check $closed "/c closes cleanly when its window is closed ($(if ($closed) { "$([math]::Round($sw.Elapsed.TotalSeconds, 1)) s" } else { 'still running' }))"
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }
Test-Drained $cTree '/c'
Physical "/c window contents, preset changes persisting, and the dialog's 'Settings...' button"

Log "`n[7] App launch (SoundwavianField.exe), cold WebView2 profile"
Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
$proc = Start-Direct $exe ''
$title = Wait-WindowTitle $proc 'Soundwavian Field*' 20
Check ($null -ne $title) "app opens its window ('$title')"
Start-Sleep -Seconds 8
Check (-not $proc.HasExited) 'app keeps running'
$shot = Measure-Region ([System.Drawing.Rectangle]::Empty) (Join-Path $ReportDir "app-$kind.png")
Log "  screen: mean luma $($shot.MeanLuma), lit fraction $($shot.LitFraction)"
Check ($shot.MeanLuma -gt 8) 'app renders the field'
$aTree = Get-ProcessTree $proc.Id
Test-ChildNames $aTree 'app'
$aSockets = @(Get-TreeSockets $aTree)
Check ($aSockets.Count -eq 0) "app: no network sockets $(if ($aSockets.Count) { '-> ' + ($aSockets -join '; ') })"
[void]$proc.CloseMainWindow()
$closed = $proc.WaitForExit(10000)
Check $closed 'app exits when its window is closed'
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }
Test-Drained $aTree 'app'

Log "`n[8] /s first launch (cold WebView2 profile), mouse dismissal"
Test-ScreenSaver '/s first launch' 'mouse' $true $RunSeconds

Log "`n[9] /s keyboard dismissal"
Test-ScreenSaver '/s keyboard' 'keyboard' $false 10

Log "`n[10] /s with outbound network blocked for the app and WebView2"
$ruleGroup = 'SoundwavianField-offline-test'
$fwProfiles = $null
$firewallReady = $false
try {
  $fwProfiles = Get-NetFirewallProfile | Select-Object Name, Enabled
  $programs = @($scr, $exe) + @(Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application" -Recurse -Filter msedgewebview2.exe -ErrorAction SilentlyContinue | ForEach-Object FullName)
  foreach ($prog in $programs) {
    New-NetFirewallRule -DisplayName "SField offline test $([IO.Path]::GetFileName($prog))" -Group $ruleGroup -Direction Outbound -Program $prog -Action Block -Profile Any | Out-Null
  }
  Set-NetFirewallProfile -All -Enabled True
  $firewallReady = $true
  Log "  blocked outbound for $($programs.Count) programs (SoundwavianField + every installed msedgewebview2.exe)"
} catch {
  NotRun "offline run: could not configure Windows Firewall ($_)"
}
try {
  if ($firewallReady) { Test-ScreenSaver '/s offline' 'mouse' $true 12 }
} finally {
  Remove-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue
  if ($fwProfiles) { foreach ($fp in $fwProfiles) { Set-NetFirewallProfile -Name $fp.Name -Enabled $fp.Enabled -ErrorAction SilentlyContinue } }
}

# A crash during exit is invisible in the exit code once the process has
# been terminated, but Windows still records it (and holds the process for
# Windows Error Reporting). Release testing found exactly that, so check.
$crashes = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001, 1002; StartTime = $testStart } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'SoundwavianField' })
foreach ($c in $crashes) { Log "  crash report (event $($c.Id), $($c.TimeCreated.ToString('HH:mm:ss'))): $(($c.Message -split "`n" | Select-Object -First 3) -join ' | ')" }
Check ($crashes.Count -eq 0) "no crash or hang reports for SoundwavianField in the Application log during the test"

Log "`n[11] Uninstall"
if ($kind -eq 'msi') {
  $p = Start-Process msiexec.exe -ArgumentList @('/x', "`"$Installer`"", '/qn', '/norestart') -Wait -PassThru
} else {
  $p = Start-Process (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -Wait -PassThru
  Start-Sleep -Seconds 5  # the NSIS uninstaller re-launches itself from a temp copy
}
Check ($p.ExitCode -eq 0) "uninstaller exit code $($p.ExitCode)"
Check (-not (Test-Path $exe)) 'application files removed'
$startMenu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'
$shortcuts = @(Get-ChildItem $startMenu -Recurse -Filter '*Soundwavian*' -ErrorAction SilentlyContinue)
Check ($shortcuts.Count -eq 0) "Start Menu entries removed $(if ($shortcuts.Count) { '-> ' + ($shortcuts.FullName -join '; ') })"
$desktop = @(Get-ChildItem ([Environment]::GetFolderPath('CommonDesktopDirectory')), ([Environment]::GetFolderPath('Desktop')) -Filter '*Soundwavian*' -ErrorAction SilentlyContinue)
Check ($desktop.Count -eq 0) "desktop shortcuts removed $(if ($desktop.Count) { '-> ' + ($desktop.FullName -join '; ') })"
$final = Get-PersistenceSnapshot
foreach ($kindName in 'Services', 'Tasks', 'Run', 'Startup') {
  $new = Compare-Set $before.$kindName $final.$kindName
  Check ($new.Count -eq 0) "no leftover $kindName"
}
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'SoundwavianField*' })
Check ($running.Count -eq 0) 'no Soundwavian Field process running'

Log "`nResult: $(if ($failures) { "$failures check(s) FAILED" } else { 'all automated checks passed' }) (PHYSICAL items are not covered by this test)"
$lines | Set-Content -Path $report -Encoding utf8
if ($failures) { exit 1 }
