# 브랜드 원본(tools/brand/source)에서 앱 아이콘·스플래시·첫 화면·파비콘·README 로고를 만든다(#134).
# Windows 내장 .NET System.Drawing만 쓴다. 저장소 루트에서 실행한다:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/brand/generate-brand-assets.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backgroundLogo = [System.Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot 'source\logo-background.png'))
$transparentLogo = [System.Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot 'source\logo-transparent.png'))
# 배경 버전 가장자리 평균색. res/values/ic_launcher_background.xml과 같아야 한다.
$navy = [System.Drawing.Color]::FromArgb(255, 0x0A, 0x0E, 0x1F)
$res = Join-Path $root 'android\app\src\main\res'

function New-Canvas([int]$width, [int]$height) {
  $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bitmap.SetResolution(72, 72)
  return $bitmap
}

function New-Graphics($bitmap) {
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  return $g
}

# 원본을 (x, y, size) 정사각형에 그린다. 가장자리 번짐을 막으려고 TileFlipXY를 쓴다.
function Draw-Logo($g, $source, [double]$x, [double]$y, [double]$size) {
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dest = New-Object System.Drawing.Rectangle([int][math]::Round($x), [int][math]::Round($y), [int][math]::Round($size), [int][math]::Round($size))
  $g.DrawImage($source, $dest, 0, 0, $source.Width, $source.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  $attributes.Dispose()
}

function Save-Png($bitmap, [string]$path) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  Write-Output ("{0} {1}" -f $path.Substring($root.Length + 1), (Get-Item $path).Length)
}

# 정사각형으로 줄인 사본.
function Save-Square($source, [int]$size, [string]$path) {
  $canvas = New-Canvas $size $size
  $g = New-Graphics $canvas
  Draw-Logo $g $source 0 0 $size
  $g.Dispose()
  Save-Png $canvas $path
}

# 원형 아이콘: 배경 버전을 안티앨리어싱된 원 안에만 칠한다.
function Save-Round($source, [int]$size, [string]$path) {
  $scaled = New-Canvas $size $size
  $sg = New-Graphics $scaled
  Draw-Logo $sg $source 0 0 $size
  $sg.Dispose()
  $canvas = New-Canvas $size $size
  $g = New-Graphics $canvas
  $brush = New-Object System.Drawing.TextureBrush($scaled)
  $g.FillEllipse($brush, 0, 0, $size, $size)
  $brush.Dispose()
  $g.Dispose()
  $scaled.Dispose()
  Save-Png $canvas $path
}

# 적응형 아이콘 전경: 108dp 캔버스 가운데에 64dp 로고(원형 마스크 안전 영역 안).
function Save-Foreground($source, [int]$size, [string]$path) {
  $canvas = New-Canvas $size $size
  $g = New-Graphics $canvas
  $logo = $size * 64.0 / 108.0
  Draw-Logo $g $source (($size - $logo) / 2) (($size - $logo) / 2) $logo
  $g.Dispose()
  Save-Png $canvas $path
}

# 스플래시: 남색 바탕 가운데에 짧은 변의 50% 크기 투명 로고.
function Save-Splash($source, [int]$width, [int]$height, [string]$path) {
  $canvas = New-Canvas $width $height
  $g = New-Graphics $canvas
  $g.Clear($navy)
  $logo = [math]::Min($width, $height) * 0.5
  Draw-Logo $g $source (($width - $logo) / 2) (($height - $logo) / 2) $logo
  $g.Dispose()
  Save-Png $canvas $path
}

$densities = [ordered]@{ mdpi = 1.0; hdpi = 1.5; xhdpi = 2.0; xxhdpi = 3.0; xxxhdpi = 4.0 }
foreach ($density in $densities.Keys) {
  $scale = $densities[$density]
  $launcher = [int][math]::Round(48 * $scale)
  $foreground = [int][math]::Round(108 * $scale)
  Save-Square $backgroundLogo $launcher (Join-Path $res "mipmap-$density\ic_launcher.png")
  Save-Round $backgroundLogo $launcher (Join-Path $res "mipmap-$density\ic_launcher_round.png")
  Save-Foreground $transparentLogo $foreground (Join-Path $res "mipmap-$density\ic_launcher_foreground.png")
}

# 기존 스플래시 파일 크기를 그대로 유지한다.
$splashSizes = [ordered]@{
  'drawable' = @(480, 320)
  'drawable-port-mdpi' = @(320, 480); 'drawable-land-mdpi' = @(480, 320)
  'drawable-port-hdpi' = @(480, 800); 'drawable-land-hdpi' = @(800, 480)
  'drawable-port-xhdpi' = @(720, 1280); 'drawable-land-xhdpi' = @(1280, 720)
  'drawable-port-xxhdpi' = @(960, 1600); 'drawable-land-xxhdpi' = @(1600, 960)
  'drawable-port-xxxhdpi' = @(1280, 1920); 'drawable-land-xxxhdpi' = @(1920, 1280)
}
foreach ($folder in $splashSizes.Keys) {
  $size = $splashSizes[$folder]
  Save-Splash $transparentLogo $size[0] $size[1] (Join-Path $res "$folder\splash.png")
}

# 첫 화면 로고(CSS 160px의 3배), 파비콘, README 로고.
Save-Square $transparentLogo 480 (Join-Path $root 'src\ui\assets\brand-logo.png')
Save-Square $backgroundLogo 64 (Join-Path $root 'public\favicon.png')
Save-Square $backgroundLogo 320 (Join-Path $root 'docs\assets\brand-logo.png')

$backgroundLogo.Dispose()
$transparentLogo.Dispose()
