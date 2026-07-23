<#
.SYNOPSIS
  PowerPoint playback canary — proves an animation actually PLAYS, not merely that it parses.

.DESCRIPTION
  The byte inspector proves native animation topology exists. It cannot prove PowerPoint plays it.
  This drives a real PowerPoint runtime: it starts the slideshow, captures the initial state, then
  advances the animation once per declared transition and captures each resulting frame.

  Each frame is reduced to a small grayscale signature. Distinct states must produce distinct
  signatures — if advancing changes nothing on screen, the "animation" did not really run, and the
  gate is expected to fail on identical frames rather than accept the file.

.PARAMETER Pptx
  Deck to play.
.PARAMETER ScenesJson
  [{ "sceneId": "...", "slide": 21, "states": 5 }, ...]
.PARAMETER OutJson
  Where to write { sceneId: [ { signature, index } ] }.
.PARAMETER FrameDir
  Optional directory to keep the captured PNGs as evidence.
#>
param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [Parameter(Mandatory = $true)][string]$ScenesJson,
  [Parameter(Mandatory = $true)][string]$OutJson,
  [string]$FrameDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Get-FrameSignature {
  param([System.Drawing.Bitmap]$Bitmap)
  # Downscale to a small grid and hash the grayscale values. Robust to sub-pixel AA jitter, but
  # still sensitive to a shape appearing — which is exactly the state change we are proving.
  $w = 64; $h = 36
  $small = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($Bitmap, 0, 0, $w, $h)
  $g.Dispose()
  $sb = New-Object System.Text.StringBuilder
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $p = $small.GetPixel($x, $y)
      # Quantize to 16 levels so encoder noise cannot fake a state change.
      $lum = [int](((0.299 * $p.R) + (0.587 * $p.G) + (0.114 * $p.B)) / 16)
      [void]$sb.Append($lum.ToString('x'))
    }
  }
  $small.Dispose()
  $bytes = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
}

function Get-ScreenBitmap {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $g.Dispose()
  return $bmp
}

$scenes = Get-Content -Raw -Path $ScenesJson | ConvertFrom-Json
if ($FrameDir -and -not (Test-Path $FrameDir)) { New-Item -ItemType Directory -Force -Path $FrameDir | Out-Null }

$app = $null
$pres = $null
$result = @{}

try {
  $app = New-Object -ComObject PowerPoint.Application
  $app.Visible = -1   # msoTrue; the interop enum type is not loaded in a bare PowerShell host.
  # ReadOnly, Untitled=false, WithWindow=true (a slideshow needs a window).
  $pres = $app.Presentations.Open((Resolve-Path $Pptx).Path, $true, $false, $true)

  $pres.SlideShowSettings.ShowType = 1   # ppShowTypeSpeaker
  [void]$pres.SlideShowSettings.Run()
  Start-Sleep -Milliseconds 1500
  $view = $pres.SlideShowWindow.View

  foreach ($scene in $scenes) {
    $frames = @()
    $view.GotoSlide([int]$scene.slide)
    Start-Sleep -Milliseconds 900

    for ($i = 0; $i -lt [int]$scene.states; $i++) {
      if ($i -gt 0) {
        # One advance per declared transition: N states means N-1 advances.
        $view.Next()
        Start-Sleep -Milliseconds 900
      }
      $bmp = Get-ScreenBitmap
      $sig = Get-FrameSignature -Bitmap $bmp
      if ($FrameDir) {
        $bmp.Save((Join-Path $FrameDir ("{0}-state-{1}.png" -f $scene.sceneId, ($i + 1))),
          [System.Drawing.Imaging.ImageFormat]::Png)
      }
      $bmp.Dispose()
      # PSCustomObject, not a hashtable: the summary below needs property access.
      $frames += [pscustomobject]@{ index = $i; signature = $sig }
    }
    $result[$scene.sceneId] = $frames
    $distinct = ($frames.signature | Sort-Object -Unique).Count
    Write-Output ("captured {0}: {1} frames, {2} distinct" -f $scene.sceneId, $frames.Count, $distinct)
  }
}
finally {
  if ($pres) {
    try { if ($pres.SlideShowWindow) { $pres.SlideShowWindow.View.Exit() } } catch {}
    try { $pres.Close() } catch {}
  }
  if ($app) { try { $app.Quit() } catch {} }
  [System.GC]::Collect()
}

# UTF-8 WITHOUT a BOM: Out-File -Encoding utf8 emits one, and JSON.parse rejects it.
$json = $result | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($OutJson, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("wrote {0}" -f $OutJson)
