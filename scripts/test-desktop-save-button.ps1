# Real HWND rejection-path checks. They never send a click, read window text,
# touch application files or target a window outside this process's fixtures.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -Path (Join-Path $PSScriptRoot 'desktop-save-button.cs')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SaveButtonFixture {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern IntPtr CreateWindowExW(uint ex, string cls, string name, uint style,
        int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr window);
    public static IntPtr Create(string cls, IntPtr parent, int id, bool visible, bool enabled) {
        uint style = parent == IntPtr.Zero ? 0x80000000u : 0x40000000u;
        if (visible) style |= 0x10000000u;
        if (!enabled) style |= 0x08000000u;
        var window = CreateWindowExW(0, cls, "MDviewer guard fixture", style, 0, 0, 120, 80,
            parent, new IntPtr(id), IntPtr.Zero, IntPtr.Zero);
        if (window == IntPtr.Zero) throw new InvalidOperationException("Could not create native guard fixture.");
        return window;
    }
}
'@
$windows = [System.Collections.Generic.List[IntPtr]]::new()
function New-Fixture([string]$Class, [IntPtr]$Parent = [IntPtr]::Zero, [int]$Id = 0,
    [bool]$Visible = $true, [bool]$Enabled = $true) {
    $handle = [SaveButtonFixture]::Create($Class, $Parent, $Id, $Visible, $Enabled)
    $windows.Add($handle)
    return $handle
}
function Expect-Rejected([string]$Name, [scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Guard incorrectly accepted: $Name" }
    Write-Host "PASS rejected $Name"
}
try {
    $dialog = New-Fixture '#32770'
    $button = New-Fixture 'Button' $dialog 1
    if ([SmokeSaveButton]::Validate($dialog, [uint32]$PID) -ne $button) { throw 'Valid native Save button was not returned.' }
    Write-Host 'PASS exact owned dialog/button'
    Expect-Rejected 'zero handle' { [SmokeSaveButton]::Validate([IntPtr]::Zero, [uint32]$PID) }
    Expect-Rejected 'broadcast handle' { [SmokeSaveButton]::Validate([IntPtr]0xffff, [uint32]$PID) }
    Expect-Rejected 'wrong process' { [SmokeSaveButton]::Validate($dialog, [uint32]($PID + 1)) }
    Expect-Rejected 'unknown process' { [SmokeSaveButton]::Validate($dialog, 0) }
    $wrongDialog = New-Fixture 'Static'
    [void](New-Fixture 'Button' $wrongDialog 1)
    Expect-Rejected 'wrong dialog class' { [SmokeSaveButton]::Validate($wrongDialog, [uint32]$PID) }
    foreach ($case in @('missing', 'wrong-class', 'wrong-id', 'disabled', 'hidden', 'nested')) {
        $fixture = New-Fixture '#32770'
        switch ($case) {
            'wrong-class' { [void](New-Fixture 'Edit' $fixture 1) }
            'wrong-id' { [void](New-Fixture 'Button' $fixture 2) }
            'disabled' { [void](New-Fixture 'Button' $fixture 1 $true $false) }
            'hidden' { [void](New-Fixture 'Button' $fixture 1 $false $true) }
            'nested' { $panel = New-Fixture 'Static' $fixture 10; [void](New-Fixture 'Button' $panel 1) }
        }
        Expect-Rejected $case { [SmokeSaveButton]::Validate($fixture, [uint32]$PID) }
    }
} finally {
    for ($i = $windows.Count - 1; $i -ge 0; $i--) { [void][SaveButtonFixture]::DestroyWindow($windows[$i]) }
}
