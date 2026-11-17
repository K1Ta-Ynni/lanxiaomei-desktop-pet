param([ValidateSet('once','wake','continuous','probe')][string]$Mode = 'once', [string]$Culture = 'default', [string]$WakePhrase = '蓝小妹')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Emit($value) { [Console]::WriteLine(($value | ConvertTo-Json -Compress)) }
$engine = $null
try {
  Add-Type -AssemblyName System.Speech
  $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if ($Mode -eq 'probe') {
    $languages = @($recognizers | ForEach-Object { @{ culture=$_.Culture.Name; name=$_.Culture.NativeName } })
    Emit @{ languages=$languages }
    exit 0
  }
  $recognizer = if ($Culture -eq 'default') { $recognizers | Select-Object -First 1 } else { $recognizers | Where-Object { $_.Culture.Name -eq $Culture } | Select-Object -First 1 }
  if (-not $recognizer) { throw '没有找到所选语言的 Windows 语音识别组件。可以继续使用文字聊天，或在 Windows 语音语言设置中安装识别组件。' }
  $engine = [System.Speech.Recognition.SpeechRecognitionEngine]::new($recognizer)
  $engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $engine.SetInputToDefaultAudioDevice()
  Emit @{ type='listening'; mode=$Mode }
  $deadline = [DateTime]::UtcNow.AddSeconds(18)
  $awakeUntil = [DateTime]::MinValue
  while ($Mode -ne 'once' -or [DateTime]::UtcNow -lt $deadline) {
    $result = $engine.Recognize([TimeSpan]::FromSeconds(3))
    if (-not $result -or $result.Confidence -lt 0.3) {
      if ($Mode -eq 'wake' -and $awakeUntil -ne [DateTime]::MinValue -and [DateTime]::UtcNow -ge $awakeUntil) {
        $awakeUntil = [DateTime]::MinValue
        Emit @{ type='listening'; mode='wake' }
      }
      continue
    }
    $text = $result.Text.Trim()
    if ($Mode -eq 'once') { Emit @{ type='transcript'; text=$text }; break }
    if ($Mode -eq 'continuous') { Emit @{ type='transcript'; text=$text }; continue }
    $escapedWake = [Regex]::Escape($WakePhrase)
    if ([Regex]::IsMatch($text, $escapedWake, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
      $awakeUntil = [DateTime]::UtcNow.AddSeconds(15)
      $rest = ($text -replace ('^.*?' + $escapedWake + '[，,。！!、 ]*'),'').Trim()
      Emit @{ type='wake'; text=$rest }
      if ($rest) { $awakeUntil = [DateTime]::MinValue }
    } elseif ([DateTime]::UtcNow -lt $awakeUntil) {
      Emit @{ type='transcript'; text=$text }
      $awakeUntil = [DateTime]::MinValue
    }
  }
} catch {
  Emit @{ type='error'; message=$_.Exception.Message }
  exit 1
} finally { if ($engine) { $engine.Dispose() } }
