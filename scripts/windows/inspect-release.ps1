<#
.SYNOPSIS
  Static inspection of the release installers for the security review.

.DESCRIPTION
  Does not install anything. Performs a Windows Installer *administrative
  extraction* of the MSI (unpacks files only, writes no registry, runs no
  custom actions) and queries the MSI database tables that describe every
  change the installer can make: files, registry, shortcuts, services,
  custom actions, environment, and scheduled/elevated work.

  Output: dist\release\reports\inspection.txt (the generated WiX / NSIS
  sources are copied into dist\release\reports\installer-sources\ by the
  release script).
#>
param(
  [string] $ReleaseDir = (Join-Path $PSScriptRoot '..\..\dist\release')
)
$ErrorActionPreference = 'Stop'
$ReleaseDir = (Resolve-Path $ReleaseDir).Path
$reports = Join-Path $ReleaseDir 'reports'
New-Item -ItemType Directory -Force -Path $reports | Out-Null
$out = [System.Collections.Generic.List[string]]::new()

# dumpbin ships with the Visual C++ build tools; it is not on PATH by default.
$dumpbin = (Get-Command dumpbin.exe -ErrorAction SilentlyContinue).Source
if (-not $dumpbin) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path $vswhere) {
    $dumpbin = & $vswhere -latest -products * -find 'VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe' | Select-Object -First 1
  }
}
function Log([string] $m) { Write-Host $m; $out.Add($m) }

$msi = Get-ChildItem $ReleaseDir -Filter *.msi | Select-Object -First 1
if (-not $msi) { throw "No MSI in $ReleaseDir" }

Log "Soundwavian Field - release inspection - $(Get-Date -Format o)"
Log "MSI: $($msi.Name)  SHA-256 $((Get-FileHash $msi.FullName).Hash)"

# --- MSI database tables ------------------------------------------------------
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($msi.FullName, 0))

function Query-Table([string] $table, [string[]] $columns) {
  try {
    $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT $($columns -join ', ') FROM ``$table``"))
    $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
    $rows = @()
    while ($true) {
      $rec = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
      if (-not $rec) { break }
      $vals = for ($i = 1; $i -le $columns.Count; $i++) { $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, $i) }
      $rows += ($vals -join ' | ')
    }
    $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
    return , $rows
  } catch {
    return $null  # table not present in this package
  }
}

$tables = [ordered]@{
  'Property'         = @('Property', 'Value')
  'File'             = @('FileName', 'FileSize')
  'Registry'         = @('Root', 'Key', 'Name', 'Value')
  'RemoveRegistry'   = @('Root', 'Key', 'Name')
  'Shortcut'         = @('Name', 'Directory_', 'Target', 'Arguments')
  'ServiceInstall'   = @('Name', 'DisplayName', 'StartType')
  'ServiceControl'   = @('Name', 'Event')
  'CustomAction'     = @('Action', 'Type', 'Source', 'Target')
  'Environment'      = @('Name', 'Value')
  'IniFile'          = @('FileName', 'Section', 'Key', 'Value')
  'CreateFolder'     = @('Directory_', 'Component_')
  'RemoveFile'       = @('FileName', 'DirProperty')
}
foreach ($t in $tables.Keys) {
  $rows = Query-Table $t $tables[$t]
  if ($null -eq $rows) { Log "`n[$t] (table not present)"; continue }
  Log "`n[$t] $($rows.Count) row(s)"
  foreach ($r in $rows) {
    Log "  $r"
  }
}
Log "`nRoot codes: 0=HKCR 1=HKCU 2=HKLM 3=HKU -1=per-user/per-machine by install scope"

# --- Administrative extraction (files only) ----------------------------------
$extract = Join-Path $env:TEMP "sfield-inspect-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $extract | Out-Null
$p = Start-Process msiexec.exe -ArgumentList @('/a', "`"$($msi.FullName)`"", '/qn', "TARGETDIR=`"$extract`"") -Wait -PassThru
Log "`n[Payload] administrative extraction exit code $($p.ExitCode)"
Get-ChildItem $extract -Recurse -File | Where-Object { $_.Extension -ne '.msi' } | ForEach-Object {
  $sig = Get-AuthenticodeSignature $_.FullName
  $isPe = $false
  try {
    $fs = [IO.File]::OpenRead($_.FullName); $b = New-Object byte[] 2; [void]$fs.Read($b, 0, 2); $fs.Close()
    $isPe = ($b[0] -eq 0x4D -and $b[1] -eq 0x5A)
  } catch {}
  $vi = $_.VersionInfo
  Log ("  {0,-30} {1,11:N0} B  PE={2,-5} sig={3,-10} '{4}' {5} orig='{6}'" -f $_.Name, $_.Length, $isPe, $sig.Status, $vi.FileDescription, $vi.FileVersion, $vi.OriginalFilename)
  if ($isPe) {
    if ($dumpbin) {
      $deps = & $dumpbin /nologo /dependents $_.FullName | Where-Object { $_ -match '^\s+\S+\.(dll|DLL)$' } | ForEach-Object { $_.Trim().ToLower() } | Sort-Object -Unique
      Log "      imported DLLs ($($deps.Count)): $($deps -join ', ')"
      $sections = & $dumpbin /nologo /headers $_.FullName | Select-String -Pattern 'SECTION HEADER #\d+' -Context 0, 1 | ForEach-Object { $_.Context.PostContext[0].Trim().Split(' ')[0] }
      Log "      PE sections: $($sections -join ', ')  (UPX/packers would show UPX0/UPX1/.aspack/etc.)"
    } else {
      Log '      (dumpbin not found - import table not inspected)'
    }
  }
}
Remove-Item $extract -Recurse -Force

# --- Signatures of distributables -------------------------------------------
Log "`n[Signatures]"
Get-ChildItem $ReleaseDir -File | Where-Object { $_.Extension -in '.exe', '.scr', '.msi' } | ForEach-Object {
  $s = Get-AuthenticodeSignature $_.FullName
  Log ("  {0,-40} {1,-12} {2}" -f $_.Name, $s.Status, $s.SignerCertificate.Subject)
}

$out | Set-Content -Path (Join-Path $reports 'inspection.txt') -Encoding utf8
Log "`nWrote $(Join-Path $reports 'inspection.txt')"
