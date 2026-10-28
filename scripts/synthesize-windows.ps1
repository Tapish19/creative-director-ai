param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$VoiceName = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($VoiceName) { $synthesizer.SelectVoice($VoiceName) }
  else { $synthesizer.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('en-US')) }
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synthesizer.SetOutputToWaveFile($OutputPath, $format)
  $synthesizer.Speak([System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8))
} finally { $synthesizer.Dispose() }
