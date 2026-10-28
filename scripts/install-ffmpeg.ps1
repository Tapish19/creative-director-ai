param([switch]$RegistryFallback)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolRoot = Join-Path $workspaceRoot '.tools/ffmpeg'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
if ($RegistryFallback) {
  # Explicit alternative for networks that block GitHub release downloads. Windows x64 only.
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'The registry binaries require Windows x64.' }
  $pythonRoot = Join-Path $toolRoot 'python'
  $localRoot = Join-Path $toolRoot 'local'
  $localBin = Join-Path $localRoot 'bin'
  New-Item -ItemType Directory -Force -Path $localBin | Out-Null
  python -m pip install --upgrade --target $pythonRoot 'imageio-ffmpeg==0.6.0'
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the FFmpeg wheel.' }
  npm pack '@ffprobe-installer/win32-x64@5.1.0' --pack-destination $toolRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the FFprobe package.' }
  $probeArchive = Join-Path $toolRoot 'ffprobe-installer-win32-x64-5.1.0.tgz'
  tar -xzf $probeArchive -C $localRoot
  if ($LASTEXITCODE -ne 0) { throw 'Could not extract FFprobe.' }
  $encoder = Join-Path $pythonRoot 'imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
  $probe = Join-Path $localRoot 'package/ffprobe.exe'
  Copy-Item -LiteralPath $encoder -Destination (Join-Path $localBin 'ffmpeg.exe') -Force
  Copy-Item -LiteralPath $probe -Destination (Join-Path $localBin 'ffprobe.exe') -Force
  Write-Output "Installed workspace-local development binaries: $localBin"
  & (Join-Path $localBin 'ffmpeg.exe') -version | Select-Object -First 1
  & (Join-Path $localBin 'ffprobe.exe') -version | Select-Object -First 1
  exit 0
}
$archive = Join-Path $toolRoot 'essentials.zip'
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/GyanD/codexffmpeg/releases/latest'
$asset = $release.assets | Where-Object { $_.name -match '-essentials_build\.zip$' } | Select-Object -First 1
if (-not $asset -or -not $asset.browser_download_url.StartsWith('https://github.com/GyanD/codexffmpeg/releases/download/')) { throw 'Unexpected FFmpeg release asset.' }
$expected = [regex]::Match([string]$asset.digest, '[a-fA-F0-9]{64}').Value
if (-not $expected) { throw 'Could not read the FFmpeg archive checksum.' }
Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'FFmpeg archive checksum mismatch.' }
Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force
$binary = Get-ChildItem -LiteralPath $toolRoot -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1
if (-not $binary) { throw 'FFmpeg binary missing from archive.' }
$binPath = [System.IO.Path]::GetFullPath($binary.DirectoryName)
if (-not $binPath.StartsWith($toolRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected FFmpeg binary path.' }
Write-Output "Installed workspace-local FFmpeg: $binPath"
& $binary.FullName -version | Select-Object -First 1
