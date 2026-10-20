Add-Type -AssemblyName System.Drawing
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$source = [Drawing.Bitmap]::FromFile((Join-Path $root 'tools/brand/source/logo-background.png'))
try {
    $canvas = [Drawing.Bitmap]::new(1024,1024,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.Clear([Drawing.Color]::FromArgb(10,14,31))
        $graphics.DrawImage($source,0,0,1024,1024)
        $canvas.Save((Join-Path $root 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $canvas.Dispose() }
} finally { $source.Dispose() }
