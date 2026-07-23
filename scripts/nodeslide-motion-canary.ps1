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

function Get-SlideRect {
  param([int]$ScreenW, [int]$ScreenH, [double]$Aspect)
  # A slideshow letterboxes the slide inside the screen. Recover the slide's own rectangle so
  # normalised region coordinates can be mapped to real pixels.
  $screenAspect = $ScreenW / $ScreenH
  if ($screenAspect -gt $Aspect) {
    $h = $ScreenH; $w = [int]($ScreenH * $Aspect)
    return @{ x = [int](($ScreenW - $w) / 2); y = 0; w = $w; h = $h }
  }
  $w = $ScreenW; $h = [int]($ScreenW / $Aspect)
  return @{ x = 0; y = [int](($ScreenH - $h) / 2); w = $w; h = $h }
}

function Get-RegionInk {
  param([System.Drawing.Bitmap]$Bitmap, $SlideRect, $Region)
  # Fraction of clearly-dark pixels inside the region. A revealed state card carries dark text; an
  # unrevealed region is flat background. This is the per-frame signal that distinguishes
  # "state 3 is showing" from "something on screen changed".
  $x0 = $SlideRect.x + [int]($Region.x * $SlideRect.w)
  $y0 = $SlideRect.y + [int]($Region.y * $SlideRect.h)
  $rw = [Math]::Max(1, [int]($Region.w * $SlideRect.w))
  $rh = [Math]::Max(1, [int]($Region.h * $SlideRect.h))
  $dark = 0; $total = 0
  # Sample on a grid; full per-pixel scans of 11 regions x 5 frames are needlessly slow.
  for ($y = $y0; $y -lt ($y0 + $rh); $y += 2) {
    for ($x = $x0; $x -lt ($x0 + $rw); $x += 2) {
      if ($x -lt 0 -or $y -lt 0 -or $x -ge $Bitmap.Width -or $y -ge $Bitmap.Height) { continue }
      $p = $Bitmap.GetPixel($x, $y)
      $lum = (0.299 * $p.R) + (0.587 * $p.G) + (0.114 * $p.B)
      if ($lum -lt 140) { $dark++ }
      $total++
    }
  }
  if ($total -eq 0) { return 0.0 }
  return [Math]::Round($dark / $total, 4)
}

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Cap {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

<#
  Capture the SLIDESHOW WINDOW, not the primary screen.

  Capturing the whole screen is how this canary previously "proved" playback while actually
  photographing an unrelated application: the frames were distinct because something else on the
  desktop was animating. Distinctness measured on the wrong pixels is worse than no measurement,
  because it looks like proof. PowerPoint's slideshow window has class "screenClass".
#>
function Get-SlideShowRect {
  # The slideshow is a PPTFrameClass window titled "PowerPoint Slide Show - ...". Matching the
  # title matters: the ordinary editor window shares the class.
  $script:hit = [IntPtr]::Zero
  $cb = [Win32Cap+EnumProc] {
    param($h, $l)
    if ([Win32Cap]::IsWindowVisible($h)) {
      $c = New-Object Text.StringBuilder 256
      [void][Win32Cap]::GetClassName($h, $c, 256)
      if ($c.ToString() -eq 'PPTFrameClass') {
        $t = New-Object Text.StringBuilder 256
        [void][Win32Cap]::GetWindowText($h, $t, 256)
        if ($t.ToString() -like 'PowerPoint Slide Show*') { $script:hit = $h; return $false }
      }
    }
    return $true
  }
  [void][Win32Cap]::EnumWindows($cb, [IntPtr]::Zero)
  if ($script:hit -eq [IntPtr]::Zero) { return $null }
  $r = New-Object Win32Cap+RECT
  if (-not [Win32Cap]::GetWindowRect($script:hit, [ref]$r)) { return $null }
  $w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
  if ($w -lt 200 -or $hgt -lt 200) { return $null }
  # No SetForegroundWindow: PrintWindow renders an occluded window, so the canary never has to
  # steal focus from whatever the user is doing.
  return @{ handle = $script:hit; x = $r.Left; y = $r.Top; w = $w; h = $hgt }
}

<#
  Ask the window to render ITSELF (PrintWindow with PW_RENDERFULLCONTENT), rather than screen-
  scraping its coordinates. Screen-scraping captures whatever is visually on top, so any other
  window in front silently substitutes its pixels for the slide's — which is precisely how this
  canary once "proved" playback using frames of an unrelated application.
#>
function Get-WindowBitmap {
  param($Handle, $Rect)
  $bmp = New-Object System.Drawing.Bitmap $Rect.w, $Rect.h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [Win32Cap]::PrintWindow($Handle, $hdc, 2)   # PW_RENDERFULLCONTENT
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  if (-not $ok) { $bmp.Dispose(); return $null }
  return $bmp
}

<#
  Confirm the captured pixels really are this deck. The slide ground is FAF7F3 — overwhelmingly
  light. Anything dark is some other window. Without this check a capture of the wrong surface is
  indistinguishable from a successful one.
#>
function Test-IsOurSlide {
  param([System.Drawing.Bitmap]$Bitmap)
  $light = 0; $total = 0
  for ($y = 0; $y -lt $Bitmap.Height; $y += 12) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += 12) {
      $p = $Bitmap.GetPixel($x, $y)
      $lum = (0.299 * $p.R) + (0.587 * $p.G) + (0.114 * $p.B)
      if ($lum -gt 200) { $light++ }
      $total++
    }
  }
  if ($total -eq 0) { return 0.0 }
  return [Math]::Round($light / $total, 3)
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

  # ppShowTypeWindow: run the slideshow in a WINDOW rather than seizing the whole display. The
  # canary captures that window directly, so it neither needs nor takes the user's screen.
  $pres.SlideShowSettings.ShowType = 2
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
      $winRect = Get-SlideShowRect
      if (-not $winRect) {
        throw "No PowerPoint slideshow window (class screenClass) was found. Refusing to capture the desktop: a screenshot of the wrong surface would look exactly like a successful proof."
      }
      $bmp = Get-WindowBitmap -Handle $winRect.handle -Rect $winRect
      if (-not $bmp) { throw "PrintWindow could not render the slideshow window." }
      $lightFraction = Test-IsOurSlide -Bitmap $bmp
      if ($lightFraction -lt 0.5) {
        $bmp.Dispose()
        throw ("Captured window is not this deck (only {0} of sampled pixels are light; the slide ground is FAF7F3). Something else is in front of the slideshow." -f $lightFraction)
      }
      $sig = Get-FrameSignature -Bitmap $bmp
      # The window IS the slide, so regions map directly onto it.
      $slideRect = @{ x = 0; y = 0; w = $bmp.Width; h = $bmp.Height }
      # Measure every declared state region on THIS frame, so the gate can check that frame N
      # shows states 0..N-1 and not the ones that have not been revealed yet.
      $regionInk = @()
      if ($scene.regions) {
        for ($r = 0; $r -lt $scene.regions.Count; $r++) {
          $regionInk += [pscustomobject]@{
            stateIndex = $r
            ink        = Get-RegionInk -Bitmap $bmp -SlideRect $slideRect -Region $scene.regions[$r]
          }
        }
      }
      if ($FrameDir) {
        $bmp.Save((Join-Path $FrameDir ("{0}-state-{1}.png" -f $scene.sceneId, ($i + 1))),
          [System.Drawing.Imaging.ImageFormat]::Png)
      }
      $bmp.Dispose()
      # PSCustomObject, not a hashtable: the summary below needs property access.
      $frames += [pscustomobject]@{ index = $i; signature = $sig; regions = $regionInk }
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
