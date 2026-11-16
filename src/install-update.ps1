param([Parameter(Mandatory = $true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
$jobDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($JobFile))
$job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$installDirectory = [IO.Path]::GetFullPath($job.installDirectory).TrimEnd('\')
$backupDirectory = Join-Path $jobDirectory 'backup'
$failedDirectory = Join-Path $jobDirectory 'failed-new-files'
$extractDirectory = Join-Path $jobDirectory 'extracted'
$resultFile = Join-Path $jobDirectory 'result.json'
$movedOld = New-Object 'System.Collections.Generic.List[string]'
$movedNew = New-Object 'System.Collections.Generic.List[string]'
$replacementStarted = $false
function Write-Result($state, $message) {
  $result = @{ state = $state; message = $message; version = $job.version; backup = $backupDirectory } | ConvertTo-Json
  [IO.File]::WriteAllText($resultFile, $result, (New-Object System.Text.UTF8Encoding($false)))
}
try {
  if ($installDirectory -eq [IO.Path]::GetPathRoot($installDirectory) -or
      $jobDirectory.StartsWith($installDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or
      ([IO.File]::GetAttributes($installDirectory) -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Invalid installation directory.'
  }
  $mediaDirectory = [IO.Path]::GetFullPath($job.mediaDirectory).TrimEnd('\')
  if ($mediaDirectory -eq [IO.Path]::GetPathRoot($mediaDirectory) -or
      $mediaDirectory.StartsWith($installDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $mediaDirectory.StartsWith($jobDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Invalid user media directory.'
  }
  if ([IO.Path]::GetFileName($job.executable) -ne $job.executable -or
      -not (Test-Path -LiteralPath (Join-Path $installDirectory $job.executable) -PathType Leaf)) {
    throw 'The installed executable could not be found.'
  }
  if ((Get-FileHash -LiteralPath $job.zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $job.sha256) {
    throw 'The update ZIP failed its SHA-256 check.'
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  New-Item -ItemType Directory -Path $extractDirectory | Out-Null
  $archive = [IO.Compression.ZipFile]::OpenRead($job.zip)
  try {
    $expandedBytes = 0L
    foreach ($entry in $archive.Entries) {
      $entryPath = [IO.Path]::GetFullPath((Join-Path $extractDirectory $entry.FullName))
      if (-not $entryPath.StartsWith($extractDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Length -gt 1024 -or
          $entry.FullName.Contains(':') -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {
        throw 'The update ZIP contains an invalid path.'
      }
      $expandedBytes += $entry.Length
      if ($expandedBytes -gt 2147483648) { throw 'The expanded update is too large.' }
    }
  } finally { $archive.Dispose() }
  New-Item -ItemType Directory -Path $mediaDirectory -Force | Out-Null
  foreach ($kind in @('voices', 'stickers')) {
    $legacy = Join-Path $installDirectory "resources\app\assets\$kind"
    $target = Join-Path $mediaDirectory $kind
    if (Test-Path -LiteralPath $legacy -PathType Container) {
      New-Item -ItemType Directory -Path $target -Force | Out-Null
      $pending = New-Object 'System.Collections.Generic.Stack[string]'
      $pending.Push($legacy)
      while ($pending.Count -gt 0) {
        $source = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $source -Force) {
          $destination = Join-Path $target $item.FullName.Substring($legacy.Length).TrimStart('\')
          if ($item.PSIsContainer) {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            $pending.Push($item.FullName)
          } elseif (-not (Test-Path -LiteralPath $destination)) {
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
            Copy-Item -LiteralPath $item.FullName -Destination $destination
          }
        }
      }
    }
  }
  [IO.Compression.ZipFile]::ExtractToDirectory($job.zip, $extractDirectory)
  $roots = @(Get-ChildItem -LiteralPath $extractDirectory -Force)
  if ($roots.Count -ne 1 -or -not $roots[0].PSIsContainer) { throw 'The ZIP must contain exactly one application folder.' }
  $sourceDirectory = $roots[0].FullName
  $packageFile = Join-Path $sourceDirectory 'resources\app\package.json'
  $package = Get-Content -LiteralPath $packageFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($package.name -ne 'lanxiaomei-desktop-pet' -or $package.version -ne $job.version -or
      -not (Test-Path -LiteralPath (Join-Path $sourceDirectory $job.executable) -PathType Leaf)) {
    throw 'The update is not the expected application version.'
  }
  Write-Result 'ready' 'Update extracted and validated; waiting for the running application to exit.'
  if ($job.pid -gt 0) {
    $running = Get-Process -Id $job.pid -ErrorAction SilentlyContinue
    if ($running) {
      if ($running.StartTime.ToUniversalTime().ToString('o') -ne $job.processStarted) {
        throw 'The application process no longer matches this update job.'
      }
      Wait-Process -Id $job.pid -Timeout 60 -ErrorAction Stop
    }
  }
  New-Item -ItemType Directory -Path $backupDirectory | Out-Null
  $replacementStarted = $true
  foreach ($entry in Get-ChildItem -LiteralPath $sourceDirectory -Force) {
    $target = Join-Path $installDirectory $entry.Name
    if (Test-Path -LiteralPath $target) {
      Move-Item -LiteralPath $target -Destination (Join-Path $backupDirectory $entry.Name)
      $movedOld.Add($entry.Name)
    }
    Move-Item -LiteralPath $entry.FullName -Destination $target
    $movedNew.Add($entry.Name)
  }
  Write-Result 'installed' 'Update installed. Previous application files remain in the backup folder.'
  if ($job.restart) { Start-Process -FilePath (Join-Path $installDirectory $job.executable) -WorkingDirectory $installDirectory -WindowStyle Hidden }
} catch {
  $reason = $_.Exception.Message
  $rollbackFailed = $false
  if ($replacementStarted) {
    # Only move items recorded by this job; leave unrelated user files alone.
    New-Item -ItemType Directory -Path $failedDirectory -Force | Out-Null
    foreach ($name in $movedNew) {
      try { Move-Item -LiteralPath (Join-Path $installDirectory $name) -Destination (Join-Path $failedDirectory $name) -ErrorAction Stop }
      catch { $rollbackFailed = $true }
    }
    foreach ($name in $movedOld) {
      try { Move-Item -LiteralPath (Join-Path $backupDirectory $name) -Destination (Join-Path $installDirectory $name) -ErrorAction Stop }
      catch { $rollbackFailed = $true }
    }
  }
  $state = if ($rollbackFailed) { 'restore-required' } else { 'error' }
  Write-Result $state $reason
  if ($job.restart -and -not $rollbackFailed -and (Test-Path -LiteralPath (Join-Path $installDirectory $job.executable))) {
    Start-Process -FilePath (Join-Path $installDirectory $job.executable) -WorkingDirectory $installDirectory -WindowStyle Hidden
  }
  exit 1
}
