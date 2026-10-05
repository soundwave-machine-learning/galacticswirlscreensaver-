<#
.SYNOPSIS
  Static inspection of the release installers for the security review.

.DESCRIPTION
  Does not install anything. Performs a Windows Installer *administrative
  extraction* of the MSI (unpacks files only, writes no registry, runs no
  custom actions) and queries the MSI database tables that describe every
  change the installer can make: files, registry, shortcuts, services,
  custom actions, environment, and scheduled/elevated work.

  Output: dist\release\inspection.txt (plus the generated WiX / NSIS
  sources copied into dist\release\inspection\ by the release script).
#>
param(
  [string] $ReleaseDir = (Join-Path $PSScriptRoot '..\..\dist\release')
)
$ErrorActionPreference = 'Stop'
$ReleaseDir = (Resolve-Path $ReleaseDir).Path
$out = [System.Collections.Generic.List[string]]::new()
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
    # Imported DLLs (requires dumpbin from the Windows SDK / VS Build Tools if present)
    $dumpbin = Get-Command dumpbin.exe -ErrorAction SilentlyContinue
    if ($dumpbin) {
      $deps = & $dumpbin.Source /nologo /dependents $_.FullName | Where-Object { $_ -match '^\s+\S+\.(dll|DLL)$' } | ForEach-Object { $_.Trim() }
      Log "      imports: $($deps -join ', ')"
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

$out | Set-Content -Path (Join-Path $ReleaseDir 'inspection.txt') -Encoding utf8
Log "`nWrote $(Join-Path $ReleaseDir 'inspection.txt')"
