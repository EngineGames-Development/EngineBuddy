# Spike 0a driver: moves the real mouse over the spike windows, clicks, drags,
# and screenshots the avatar region. Results land in events.jsonl / shot-*.png.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class M {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public const uint LD = 0x02, LU = 0x04, RD = 0x08, RU = 0x10;
}
'@
[M]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null   # per-monitor v2: physical pixels

function Layout { Get-Content (Join-Path $here 'layout.json') -Raw | ConvertFrom-Json }
$script:last = $null
function MoveTo($p) {
  # Abort if the cursor isn't where we left it: the user is using the mouse.
  if ($script:last) { $c = New-Object M+POINT; [M]::GetCursorPos([ref]$c) | Out-Null
    if ([Math]::Abs($c.X - $script:last.x) -gt 3 -or [Math]::Abs($c.Y - $script:last.y) -gt 3) { Mark 'ABORT-user-moved-mouse'; New-Item -ItemType File (Join-Path $here 'quit') -Force | Out-Null; exit 2 } }
  [M]::SetCursorPos([int]$p.x, [int]$p.y) | Out-Null; [M]::mouse_event(0x0001,0,0,0,[IntPtr]::Zero); $script:last = @{x = [int]$p.x; y = [int]$p.y}; Start-Sleep -Milliseconds 250
}
# Only ever click when the window under the cursor belongs to an electron.exe (the spike).
function UnderCursor {
  $c = New-Object M+POINT; [M]::GetCursorPos([ref]$c) | Out-Null
  $h = [M]::WindowFromPoint($c); $procId = 0; [M]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
  $sb = New-Object System.Text.StringBuilder 256; [M]::GetWindowText($h, $sb, 256) | Out-Null
  @{ proc = (Get-Process -Id $procId).ProcessName; title = $sb.ToString() }
}
function Safe($step) {
  $u = UnderCursor
  Add-Content (Join-Path $here 'events.jsonl') ('{"who":"driver","type":"under","step":"' + $step + '","proc":"' + $u.proc + '","title":"' + $u.title + '"}')
  if ($u.proc -ne 'electron') { Mark "SKIP-$step-not-spike-window"; return $false }
  return $true
}
function Wiggle($p) { MoveTo @{x = $p.x + 2; y = $p.y}; MoveTo $p }   # forwarded mousemove triggers hit-test
function Click { [M]::mouse_event([M]::LD,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 40; [M]::mouse_event([M]::LU,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 400 }
function RClick { [M]::mouse_event([M]::RD,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 40; [M]::mouse_event([M]::RU,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 400 }
function DClick { [M]::mouse_event([M]::LD,0,0,0,[IntPtr]::Zero); [M]::mouse_event([M]::LU,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 60; [M]::mouse_event([M]::LD,0,0,0,[IntPtr]::Zero); [M]::mouse_event([M]::LU,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 500 }
function Mark($s) { Add-Content (Join-Path $here 'events.jsonl') ('{"t":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ',"who":"driver","type":"step","step":"' + $s + '"}') }
function Shot($name) {
  $l = Layout; $b = $l.avatarBounds; $sf = $l.displays[0].scaleFactor
  $x = [int]($b.x * $sf) - 40; $y = [int]($b.y * $sf) - 40; $w = [int]($b.width * $sf) + 80; $h = [int]($b.height * $sf) + 80
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $here "shot-$name.png")); $g.Dispose(); $bmp.Dispose()
}

$l = Layout
Shot 'initial'

Mark 'click-transparent'; Wiggle $l.cornerPhys; if (Safe 'ct') { Click }
Mark 'click-circle';      Wiggle $l.centerPhys; if (Safe 'cc') { Click }
Mark 'rclick-circle';     Wiggle $l.centerPhys; if (Safe 'rc') { RClick }
Mark 'dclick-circle';     Wiggle $l.centerPhys; if (Safe 'dc') { DClick }

Mark 'drag'
Wiggle $l.centerPhys
if (-not (Safe 'drag')) { New-Item -ItemType File (Join-Path $here 'quit') -Force | Out-Null; exit 3 }
[M]::mouse_event([M]::LD,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 100
for ($i = 1; $i -le 20; $i++) { [M]::SetCursorPos([int]($l.centerPhys.x - 6 * $i), [int]($l.centerPhys.y - 3 * $i)) | Out-Null; [M]::mouse_event(0x0001,0,0,0,[IntPtr]::Zero); $script:last = $null; Start-Sleep -Milliseconds 16 }
[M]::mouse_event([M]::LU,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 600

$l2 = Layout
Mark 'click-transparent-after-drag'; Wiggle $l2.cornerPhys; if (Safe 'ct2') { Click }
Mark 'click-circle-after-drag';      Wiggle $l2.centerPhys; if (Safe 'cc2') { Click }
Shot 'after-drag'

MoveTo @{x = $l.cornerPhys.x - 200; y = $l.cornerPhys.y - 200}
New-Item -ItemType File (Join-Path $here 'quit') -Force | Out-Null
Mark 'done'
