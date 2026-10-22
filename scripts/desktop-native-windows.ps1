<# Read-only native window metadata for the isolated desktop smoke process.
   No window text, file names, document content, input or window messages. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SmokeWindowMetadata {
    private delegate bool EnumWindow(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindow callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    public sealed class Window {
        public long handle;
        public long parent;
        public uint processId;
        public string nativeClass;
        public int controlId;
        public bool enabled;
        public bool visible;
    }
    public static Window[] Capture(uint owner) {
        var windows = new List<Window>();
        var seen = new HashSet<IntPtr>();
        EnumWindow collect = delegate(IntPtr hwnd, IntPtr unused) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid != owner || !seen.Add(hwnd)) return true;
            if (windows.Count >= 256) return false;
            var name = new StringBuilder(128);
            GetClassNameW(hwnd, name, name.Capacity);
            windows.Add(new Window { handle = hwnd.ToInt64(), parent = GetParent(hwnd).ToInt64(),
                processId = pid, nativeClass = name.ToString(), controlId = GetDlgCtrlID(hwnd),
                enabled = IsWindowEnabled(hwnd), visible = IsWindowVisible(hwnd) });
            return true;
        };
        EnumWindow top = delegate(IntPtr hwnd, IntPtr unused) {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == owner) {
                collect(hwnd, IntPtr.Zero);
                EnumChildWindows(hwnd, collect, IntPtr.Zero);
            }
            return windows.Count < 256;
        };
        EnumWindows(top, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@
$path = [System.IO.Path]::GetFullPath($OutputPath)
[void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($path))
$clock = [System.Diagnostics.Stopwatch]::StartNew()
# The primary smoke refuses existing mdviewer processes. Pin the observed process
# object and creation time so a recycled PID is never considered the same app.
$app = $null
while ($clock.Elapsed.TotalSeconds -lt 120) {
    if ($null -eq $app) { $app = Get-Process -Name mdviewer -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if ($null -ne $app) {
        $app.Refresh()
        if ($app.HasExited) { break }
        $snapshot = [ordered]@{ processId = $app.Id; startedAtUtc = $app.StartTime.ToUniversalTime().ToString('o');
            sampledAtUtc = [DateTime]::UtcNow.ToString('o'); windows = [SmokeWindowMetadata]::Capture([uint32]$app.Id) }
        $pending = $path + '.writing'
        [System.IO.File]::WriteAllText($pending, ($snapshot | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::Move($pending, $path, $true)
    }
    Start-Sleep -Milliseconds 500
}
