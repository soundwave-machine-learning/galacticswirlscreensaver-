<#
.SYNOPSIS
  Install / run / uninstall smoke test for Soundwavian Field on Windows.

.DESCRIPTION
  Intended for a clean Windows 10/11 VM (and run automatically on the CI
  runner). Must be run from an elevated PowerShell because the installers
  are per-machine (Program Files).

  Checks:
    - silent install succeeds; files land in Program Files
    - no services, scheduled tasks, Run/RunOnce values or Startup-folder
      items are added
    - the .scr honours /a and /p <invalid HWND> by exiting immediately
    - /s starts, makes no network connections, and leaves no processes
      behind once the main process ends
    - uninstall succeeds and removes the files and shortcuts

  The report is written next to the installer as smoke-test-<kind>.txt.

.EXAMPLE
  pwsh -File scripts\windows\smoke-test.ps1 -Installer dist\release\SoundwavianField-0.1.0-x64.msi
#>
param(
  [Parameter(Mandatory)] [string] $Installer,
  [int] $RunSeconds = 15
)

$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path $Installer).Path
$kind = if ($Installer -like '*.msi') { 'msi' } else { 'nsis' }
$report = Join-Path (Split-Path $Installer) "smoke-test-$kind.txt"
$lines = [System.Collections.Generic.List[string]]::new()
$failures = 0
function Log([string] $m) { Write-Host $m; $lines.Add($m) }
function Check([bool] $ok, [string] $m) {
  if ($ok) { Log "  PASS  $m" } else { Log "  FAIL  $m"; $script:failures++ }
}

$installDir = Join-Path $env:ProgramFiles 'Soundwavian Field'
$exe = Join-Path $installDir 'SoundwavianField.exe'
$scr = Join-Path $installDir 'SoundwavianField.scr'

function Get-PersistenceSnapshot {
  $runKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
  )
  $run = foreach ($k in $runKeys) {
    if (Test-Path $k) {
      (Get-Item $k).Property | ForEach-Object { "$k\$_" }
    }
  }
  $startupDirs = @(
    [Environment]::GetFolderPath('Startup'),
    [Environment]::GetFolderPath('CommonStartup')
  )
  [pscustomobject]@{
    Services = @(Get-Service | ForEach-Object Name)
    Tasks    = @(Get-ScheduledTask | ForEach-Object { "$($_.TaskPath)$($_.TaskName)" })
    Run      = @($run)
    Startup  = @($startupDirs | Where-Object { $_ -and (Test-Path $_) } | ForEach-Object { Get-ChildItem $_ -Force } | ForEach-Object FullName)
  }
}

function Compare-Set($before, $after) { @($after | Where-Object { $before -notcontains $_ }) }

# Start a process with CreateProcess semantics and an exact argument string -
# the way Windows starts a screen saver. (Start-Process goes through
# ShellExecute, whose "open" verb for .scr files is `"%1" /S`, which would
# replace the arguments under test.)
function Start-Direct([string] $file, [string] $arguments) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new($file, $arguments)
  $psi.UseShellExecute = $false
  [System.Diagnostics.Process]::Start($psi)
}

# Mean colour of the primary screen - proves something was actually drawn.
function Measure-Screen([string] $savePath) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = [System.Drawing.Bitmap]::new($b.Width, $b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $sum = 0.0; $n = 0; $lit = 0
  for ($y = 0; $y -lt $b.Height; $y += 8) {
    for ($x = 0; $x -lt $b.Width; $x += 8) {
      $c = $bmp.GetPixel($x, $y)
      $l = 0.2126 * $c.R + 0.7152 * $c.G + 0.0722 * $c.B
      $sum += $l; $n++; if ($l -gt 24) { $lit++ }
    }
  }
  if ($savePath) { $bmp.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png) }
  $g.Dispose(); $bmp.Dispose()
  [pscustomobject]@{ Width = $b.Width; Height = $b.Height; MeanLuma = [math]::Round($sum / [math]::Max(1, $n), 1); LitFraction = [math]::Round($lit / [math]::Max(1, $n), 3) }
}

function Get-ProcessTree([int] $rootId) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void] $ids.Add($rootId)
  do {
    $added = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) {
        [void] $ids.Add([int]$p.ProcessId); $added = $true
      }
    }
  } while ($added)
  $all | Where-Object { $ids.Contains([int]$_.ProcessId) }
}

Log "Soundwavian Field smoke test - $kind - $(Get-Date -Format o)"
Log "Installer: $Installer"
Log "SHA-256:   $((Get-FileHash $Installer -Algorithm SHA256).Hash)"
Log "OS:        $((Get-CimInstance Win32_OperatingSystem).Caption) $((Get-CimInstance Win32_OperatingSystem).Version)"
$wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
Log "WebView2:  $(if ($wv) { $wv.pv } else { 'not found in HKLM (may be per-user)' })"

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

Log "`n[2] Installed files"
Get-ChildItem $installDir -Recurse -File | ForEach-Object {
  $sig = Get-AuthenticodeSignature $_.FullName
  $ver = $_.VersionInfo
  Log ("  {0,-34} {1,10:N0} bytes  sig={2}  {3} {4}" -f $_.Name, $_.Length, $sig.Status, $ver.FileDescription, $ver.FileVersion)
}
$pe = Get-ChildItem $installDir -Recurse -File -Include *.exe, *.dll, *.scr, *.sys
Log "  executables/DLLs: $($pe.Name -join ', ')"
if (Test-Path $exe) {
  $vi = (Get-Item $exe).VersionInfo
  Log "  Version info: Product='$($vi.ProductName)' Company='$($vi.CompanyName)' Description='$($vi.FileDescription)' Original='$($vi.OriginalFilename)' Version=$($vi.FileVersion) Copyright='$($vi.LegalCopyright)'"
  $expectedCompany = if ($env:SFIELD_PUBLISHER) { $env:SFIELD_PUBLISHER } else { 'Soundwave Machine Learning' }
  Check ($vi.CompanyName -eq $expectedCompany) "CompanyName is '$expectedCompany'"
  Check ($vi.CompanyName -notmatch 'placeholder' -and $vi.LegalCopyright -notmatch 'placeholder') 'no placeholder publisher text in version info'
  # The Screen Saver Settings dialog lists a .scr by its string resource 1.
  Add-Type -Namespace SField -Name Res -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr LoadLibraryExW(string path, System.IntPtr file, uint flags);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern int LoadStringW(System.IntPtr module, uint id, System.Text.StringBuilder buffer, int max);
[DllImport("kernel32.dll")]
public static extern bool FreeLibrary(System.IntPtr module);
'@ -ErrorAction SilentlyContinue
  $mod = [SField.Res]::LoadLibraryExW($scr, [IntPtr]::Zero, 0x22)  # DATAFILE | IMAGE_RESOURCE
  $sb = [System.Text.StringBuilder]::new(256)
  $n = if ($mod -ne [IntPtr]::Zero) { [SField.Res]::LoadStringW($mod, 1, $sb, 256) } else { 0 }
  if ($mod -ne [IntPtr]::Zero) { [void][SField.Res]::FreeLibrary($mod) }
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

Log "`n[4] Screen saver argument handling"
foreach ($a in @('/a', '/p 0', '/p 999999')) {
  $proc = Start-Direct $scr $a
  $exited = $proc.WaitForExit(10000)
  if (-not $exited) { Stop-Process -Id $proc.Id -Force }
  Check $exited "'$a' exits on its own"
}

Log "`n[5] Full-screen run (/s) for $RunSeconds s"
# Always test the first-launch case: WebView2 creates its profile from scratch.
Remove-Item (Join-Path $env:LOCALAPPDATA 'com.soundwavian.field') -Recurse -Force -ErrorAction SilentlyContinue
$proc = Start-Direct $scr '/s'
$conns = @()
$tree = @()
$shot = $null
for ($i = 0; $i -lt $RunSeconds; $i++) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) { break }
  if ($i -eq 10) {
    try { $shot = Measure-Screen (Join-Path (Split-Path $Installer) "screensaver-$kind.png") } catch { Log "  (screen capture unavailable: $_)" }
  }
  $tree = @(Get-ProcessTree $proc.Id)
  $ids = $tree.ProcessId
  $conns += @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notin @('127.0.0.1', '::1', '0.0.0.0', '::') })
  $conns += @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess -and $_.LocalAddress -notin @('127.0.0.1', '::1') })
}
$why = if (-not $proc.HasExited) { 'running' } elseif ($proc.ExitCode -eq 2) { 'exit 2 = another window took the foreground' } else { "exit $($proc.ExitCode) = dismissed by input or failed to start" }
Check (-not $proc.HasExited) "/s keeps running until dismissed ($why)"
if ($shot) {
  Log "  screen $($shot.Width)x$($shot.Height): mean luma $($shot.MeanLuma), lit fraction $($shot.LitFraction)"
  Check ($shot.MeanLuma -gt 8) 'the field is visibly rendered on screen'
}
Log "  process tree:"
foreach ($t in $tree) { Log ("    {0,6} {1}" -f $t.ProcessId, $t.Name) }
Check ($conns.Count -eq 0) "no network sockets opened by the app or its WebView2 processes $(if ($conns.Count) { '-> ' + (($conns | ForEach-Object { "$($_.OwningProcess) $($_.RemoteAddress):$($_.RemotePort)$($_.LocalPort)" }) -join '; ') })"

# Real mouse movement must dismiss it (SetCursorPos generates WM_MOUSEMOVE).
if (-not $proc.HasExited) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  foreach ($pt in @(@(200, 200), @(260, 240), @(420, 380), @(600, 500))) {
    [System.Windows.Forms.Cursor]::Position = [System.Drawing.Point]::new($pt[0], $pt[1])
    Start-Sleep -Milliseconds 400
  }
  $dismissed = $proc.WaitForExit(8000)
  Check $dismissed 'moving the mouse ends the screen saver'
}
# Ending the main process must take every child with it (no lingering processes).
if (-not $proc.HasExited) { Stop-Process -Id $proc.Id }
Start-Sleep -Seconds 6
$left = @(Get-CimInstance Win32_Process | Where-Object { $tree.ProcessId -contains $_.ProcessId })
Check ($left.Count -eq 0) "no processes remain after the screen saver ends $(if ($left.Count) { '-> ' + ($left.Name -join ', ') })"

Log "`n[6] Uninstall"
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
$final = Get-PersistenceSnapshot
foreach ($kindName in 'Services', 'Tasks', 'Run', 'Startup') {
  $new = Compare-Set $before.$kindName $final.$kindName
  Check ($new.Count -eq 0) "no leftover $kindName"
}

Log "`nResult: $(if ($failures) { "$failures check(s) FAILED" } else { 'all checks passed' })"
$lines | Set-Content -Path $report -Encoding utf8
if ($failures) { exit 1 }
