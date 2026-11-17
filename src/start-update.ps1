param([Parameter(Mandatory = $true)][string]$JobDirectory)
$ErrorActionPreference = 'Stop'
try {
  $directory = [IO.Path]::GetFullPath($JobDirectory)
  $script = Join-Path $directory 'install.ps1'
  $job = Join-Path $directory 'job.json'
  if (-not (Test-Path -LiteralPath $script -PathType Leaf) -or
      -not (Test-Path -LiteralPath $job -PathType Leaf)) {
    throw 'The update job is incomplete.'
  }
  # Start-Process gives Windows PowerShell its own hidden console. Node's
  # detached: true uses DETACHED_PROCESS, which can make powershell.exe exit
  # successfully without executing -File. Sharing the old app's console also
  # risks terminating the helper when the old app exits.
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $script), '-JobFile', ('"{0}"' -f $job))
  $helper = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments `
    -WorkingDirectory $directory -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $directory 'helper-output.log') `
    -RedirectStandardError (Join-Path $directory 'helper-error.log')
  $info = @{ pid = $helper.Id; launchedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $directory 'helper-launch.json'), $info, (New-Object System.Text.UTF8Encoding($false)))
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
