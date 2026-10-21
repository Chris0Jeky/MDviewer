<#
.SYNOPSIS
Runs the real Windows desktop executable and records functional and memory evidence.
.EXAMPLE
pwsh -File scripts/desktop-smoke.ps1 -Executable src-tauri/target/x86_64-pc-windows-msvc/release/mdviewer.exe
.NOTES
Requires Windows, PowerShell 7 and an interactive desktop with WebView2 installed.
No performance thresholds are imposed. Timings include polling/accessibility overhead;
memory is sampled after UI Automation has enabled accessibility, not a pristine baseline.
The script refuses to run alongside an existing app process and cleans up only its own
processes. Use a job timeout as an additional CI watchdog (for example, five minutes).
#>
[CmdletBinding()]
param(
    [string]$Executable,
    [string]$OutputDirectory,
    [ValidateRange(5, 120)][int]$TimeoutSeconds = 45,
    [ValidateRange(60, 600)][int]$OverallTimeoutSeconds = 180,
    [ValidateRange(0, 30)][int]$SettleSeconds = 2,
    [switch]$NoScreenshot,
    # Internal out-of-process UIA worker. It uses Windows PowerShell's framework UIA.
    [switch]$Probe,
    [long]$WindowHandle,
    [ValidateSet('heading', 'button', 'save-dialog', 'screenshot')][string]$ProbeAction = 'heading',
    [string]$ButtonName,
    [string]$SavePath,
    [int]$OwnerProcessId,
    [string]$ExpectedHeading,
    [string]$ProbeOutput,
    [string]$ScreenshotPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Probe) {
    $result = [ordered]@{ found = $false; reason = $null; screenshot = $null }
    $probeClock = [System.Diagnostics.Stopwatch]::StartNew()
    $phases = [System.Collections.Generic.List[object]]::new()
    function Write-ProbePhase([string]$Phase) {
        $phases.Add([pscustomobject]@{ phase = $Phase; elapsedMs = [Math]::Round($probeClock.Elapsed.TotalMilliseconds, 2) })
        $progress = [ordered]@{
            action = $ProbeAction; lastPhase = $Phase; phases = $phases.ToArray()
            powershellVersion = $PSVersionTable.PSVersion.ToString()
            apartment = [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString()
            sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
        }
        $path = $ProbeOutput + '.progress.json'
        $pending = $path + '.writing'
        [System.IO.File]::WriteAllText($pending, ($progress | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
        if ([System.IO.File]::Exists($path)) { [System.IO.File]::Delete($path) }
        [System.IO.File]::Move($pending, $path)
    }
    function Write-ProbeResult {
        $pending = $ProbeOutput + '.writing'
        [System.IO.File]::WriteAllText($pending, ($result | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
        if ([System.IO.File]::Exists($ProbeOutput)) { [System.IO.File]::Delete($ProbeOutput) }
        [System.IO.File]::Move($pending, $ProbeOutput)
    }
    function Find-Button($Parent, [string]$Name) {
        $condition = [System.Windows.Automation.AndCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::NameProperty, $Name),
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button),
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true))
        return $Parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    }
    function Get-ControlMetadata($Element) {
        $current = $Element.Current
        $name = [string]$current.Name
        $id = [string]$current.AutomationId
        $class = [string]$current.ClassName
        $label = $current.LabeledBy
        $labelName = $(if ($null -ne $label) { [string]$label.Current.Name } else { '' })
        $value = $null
        $hasValue = $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)
        return [pscustomobject]@{
            name = $name.Substring(0, [Math]::Min(160, $name.Length))
            automationId = $id.Substring(0, [Math]::Min(160, $id.Length))
            controlType = $current.ControlType.ProgrammaticName
            className = $class.Substring(0, [Math]::Min(160, $class.Length))
            labeledByName = $labelName.Substring(0, [Math]::Min(160, $labelName.Length))
            nativeWindowHandle = $current.NativeWindowHandle
            isEnabled = $current.IsEnabled
            hasValuePattern = $hasValue
            isReadOnly = $(if ($hasValue) { $value.Current.IsReadOnly } else { $null })
        }
    }
    function Test-FilenameLabel([string]$Text) {
        $normalized = ($Text.Replace('&', '').Trim() -replace '\s+', ' ').TrimEnd(':').Trim()
        return $normalized -ieq 'File name'
    }
    function Find-FilenameValueTarget($Dialog) {
        $editableCondition = [System.Windows.Automation.OrCondition]::new(
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit),
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ComboBox))
        # Modern Common Item Dialogs expose FileNameControlHost, or the labeled
        # editable combo box. Its ValuePattern can live on the host or child Edit.
        # Never select an arbitrary Edit elsewhere in the dialog (for example Search).
        $hostCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'FileNameControlHost')
        $filenameHost = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $hostCondition)
        if ($null -eq $filenameHost) {
            $hostCondition = [System.Windows.Automation.AndCondition]::new(
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty, 'File name:'),
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ComboBox))
            $filenameHost = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $hostCondition)
        }
        $result.filenameHost = $(if ($null -ne $filenameHost) { Get-ControlMetadata $filenameHost } else { $null })
        $candidates = [System.Collections.Generic.List[object]]::new()
        if ($null -ne $filenameHost) {
            $candidates.Add($filenameHost)
            $children = $filenameHost.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editableCondition)
            for ($i = 0; $i -lt [Math]::Min(16, $children.Count); $i++) { $candidates.Add($children[$i]) }
        } else {
            $editCondition = [System.Windows.Automation.AndCondition]::new(
                [System.Windows.Automation.OrCondition]::new(
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001'),
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::NameProperty, 'File name:')),
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit))
            $legacyEdit = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
            if ($null -ne $legacyEdit) { $candidates.Add($legacyEdit) }
        }
        $controls = $Dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editableCondition)
        foreach ($control in $controls) {
            $current = $control.Current
            if ([string]$current.AutomationId -like 'System.*') { continue }
            $label = $current.LabeledBy
            $labelName = $(if ($null -ne $label) { [string]$label.Current.Name } else { '' })
            if ((Test-FilenameLabel $current.Name) -or (Test-FilenameLabel $labelName)) {
                $candidates.Add($control)
                if ($current.ControlType -eq [System.Windows.Automation.ControlType]::ComboBox) {
                    $children = $control.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editableCondition)
                    for ($i = 0; $i -lt [Math]::Min(16, $children.Count); $i++) { $candidates.Add($children[$i]) }
                }
            }
        }
        foreach ($candidate in $candidates) {
            $pattern = $null
            if ($candidate.Current.IsEnabled -and
                $candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -and
                -not $pattern.Current.IsReadOnly) {
                return [pscustomobject]@{ element = $candidate; pattern = $pattern }
            }
        }
        # File-list cells also advertise Edit, and can consume the diagnostic
        # budget before the filename row. Exclude the observed System.* columns;
        # retain only bounded control metadata, never their values or list items.
        $result.filenameControls = @()
        for ($i = 0; $i -lt $controls.Count -and $result.filenameControls.Count -lt 24; $i++) {
            if ([string]$controls[$i].Current.AutomationId -like 'System.*') { continue }
            $result.filenameControls += Get-ControlMetadata $controls[$i]
        }
        return $null
    }
    try {
        Write-ProbePhase 'worker-started'
        if ($ProbeAction -ne 'screenshot') {
            Write-ProbePhase 'loading-uia-client'
            Add-Type -AssemblyName UIAutomationClient
            Write-ProbePhase 'loading-uia-types'
            Add-Type -AssemblyName UIAutomationTypes
            Write-ProbePhase 'getting-window-element'
            $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
            Write-ProbePhase 'window-element-ready'
            if ($ProbeAction -eq 'button') {
                Write-ProbePhase 'finding-button'
                $button = Find-Button $window $ButtonName
                if ($null -eq $button) { throw 'The requested button is not enabled yet.' }
                Write-ProbePhase 'getting-button-pattern'
                $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $result.found = $true
                # Invoke can remain blocked while a modal dialog is visible. Publish
                # the attempt first; the next worker verifies the resulting state.
                Write-ProbeResult
                Write-ProbePhase 'invoking-button'
                $pattern.Invoke()
                Write-ProbePhase 'button-invoked'
                exit 0
            }
            if ($ProbeAction -eq 'save-dialog') {
                $condition = [System.Windows.Automation.AndCondition]::new(
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::NameProperty, 'Save export'),
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $OwnerProcessId))
                Write-ProbePhase 'finding-save-dialog'
                $dialog = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
                if ($null -eq $dialog) {
                    $dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
                        [System.Windows.Automation.TreeScope]::Children, $condition)
                }
                if ($null -eq $dialog) { throw 'The native Save export dialog is not visible yet.' }
                $result.saveDialog = Get-ControlMetadata $dialog
                Write-ProbePhase 'finding-filename-field'
                $filename = Find-FilenameValueTarget $dialog
                if ($null -eq $filename) { throw 'The Save dialog filename control has no enabled writable ValuePattern.' }
                $result.filenameControl = Get-ControlMetadata $filename.element
                Write-ProbePhase 'setting-filename'
                $filename.pattern.SetValue($SavePath)
                $saveCondition = [System.Windows.Automation.AndCondition]::new(
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1'),
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
                Write-ProbePhase 'finding-save-button'
                $saveButton = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $saveCondition)
                if ($null -eq $saveButton) { $saveButton = Find-Button $dialog 'Save' }
                if ($null -eq $saveButton) { throw 'The native Save button is unavailable.' }
                $savePattern = $saveButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                $result.found = $true
                Write-ProbeResult
                Write-ProbePhase 'invoking-save-button'
                $savePattern.Invoke()
                Write-ProbePhase 'save-button-invoked'
                exit 0
            }
            $containerCondition = [System.Windows.Automation.OrCondition]::new(
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty, 'Markdown document'),
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'reader-document'))
            Write-ProbePhase 'finding-reader-document'
            $document = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $containerCondition)
            if ($null -eq $document) {
                $result.reason = 'The reader document is not present in the accessibility tree.'
            } else {
                $headingCondition = [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty, $ExpectedHeading)
                Write-ProbePhase 'finding-rendered-heading'
                $heading = $document.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $headingCondition)
                $result.found = $null -ne $heading
                if (-not $result.found) { $result.reason = 'The expected heading has not rendered in the reader.' }
            }
            Write-ProbePhase 'heading-query-complete'
        }
        if (($result.found -or $ProbeAction -eq 'screenshot') -and $ScreenshotPath) {
            try {
                Write-ProbePhase 'loading-screenshot-drawing'
                Add-Type -AssemblyName System.Drawing
                Write-ProbePhase 'loading-screenshot-forms'
                Add-Type -AssemblyName System.Windows.Forms
                Write-ProbePhase 'compiling-screenshot-helper'
                Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SmokeWindow {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT bounds);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@
                Write-ProbePhase 'capturing-owned-window'
                [uint32]$windowOwner = 0
                [void][SmokeWindow]::GetWindowThreadProcessId([IntPtr]$WindowHandle, [ref]$windowOwner)
                if ($OwnerProcessId -le 0 -or $windowOwner -ne $OwnerProcessId) {
                    throw 'The capture window no longer belongs to the smoke application.'
                }
                [void][SmokeWindow]::SetProcessDPIAware()
                [void][SmokeWindow]::SetForegroundWindow([IntPtr]$WindowHandle)
                Start-Sleep -Milliseconds 150
                if ([SmokeWindow]::GetForegroundWindow() -ne [IntPtr]$WindowHandle -or
                    -not [SmokeWindow]::IsWindowVisible([IntPtr]$WindowHandle)) {
                    throw 'The test window could not be brought to the foreground.'
                }
                $bounds = [SmokeWindow+RECT]::new()
                if (-not [SmokeWindow]::GetWindowRect([IntPtr]$WindowHandle, [ref]$bounds)) {
                    throw 'The test window bounds are unavailable.'
                }
                $rectangle = [System.Drawing.Rectangle]::FromLTRB($bounds.Left, $bounds.Top, $bounds.Right, $bounds.Bottom)
                $rectangle.Intersect([System.Windows.Forms.SystemInformation]::VirtualScreen)
                if ($rectangle.Width -le 0 -or $rectangle.Height -le 0) { throw 'The test window is off screen.' }
                $bitmap = [System.Drawing.Bitmap]::new($rectangle.Width, $rectangle.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                try {
                    $graphics.CopyFromScreen($rectangle.Location, [System.Drawing.Point]::Empty, $rectangle.Size)
                    $bitmap.Save($ScreenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
                } finally { $graphics.Dispose(); $bitmap.Dispose() }
                $result.screenshot = @{ saved = $true; file = [System.IO.Path]::GetFileName($ScreenshotPath) }
                Write-ProbePhase 'screenshot-complete'
            } catch {
                $result.screenshot = @{ saved = $false; reason = $_.Exception.Message }
            }
        }
    } catch {
        $message = [string]$_.Exception.Message
        $result.reason = 'UI Automation probe failed: ' + $_.Exception.GetType().Name + ': ' +
            $message.Substring(0, [Math]::Min(1024, $message.Length))
    }
    Write-ProbePhase 'worker-complete'
    Write-ProbeResult
    exit 0
}

if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows) {
    throw 'Run this harness using PowerShell 7 on Windows.'
}
if (-not $Executable) { throw 'Pass -Executable with the built mdviewer.exe path.' }
# Windows PowerShell 5.1 can bind parameter defaults before PSScriptRoot is
# initialized. Only the parent harness needs this path; probe workers return above.
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '../artifacts/desktop-smoke' }
$exe = (Resolve-Path -LiteralPath $Executable).Path
if ([System.IO.Path]::GetExtension($exe) -ine '.exe') { throw 'Executable must be a Windows .exe file.' }
$out = [System.IO.Path]::GetFullPath($OutputDirectory)
[void][System.IO.Directory]::CreateDirectory($out)
$workerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$owned = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$workerOutput = @{}
$observed = @{}
$app = $null
$fixtureDirectory = $null
$failure = $null
$runClock = [System.Diagnostics.Stopwatch]::StartNew()
$metrics = [ordered]@{
    schemaVersion = 1
    status = 'running'
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    executable = [System.IO.Path]::GetFileName($exe)
    executableSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    osVersion = [Environment]::OSVersion.VersionString
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    runnerSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    firstLaunch = $null
    secondLaunch = $null
    samples = @()
    probes = @()
    notes = @(
        'Startup timings are upper bounds observed by polling and UI Automation, not cache-controlled benchmarks.',
        'Samples include the app and its observed descendants; UI Automation worker processes are excluded.',
        'Private working set is resident unshared memory. Private bytes are committed memory, not resident RAM.',
        'Summed working sets can count shared pages more than once. No memory or timing pass threshold is used.',
        'UI Automation enables browser accessibility before memory sampling; compare runs with the same harness.'
    )
    cleanupErrors = @()
}

function Start-OwnedProcess([string]$File, [string[]]$Arguments, [string]$WorkingDirectory, [switch]$CaptureOutput) {
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $File
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = $WorkingDirectory
    $info.RedirectStandardOutput = $CaptureOutput.IsPresent
    $info.RedirectStandardError = $CaptureOutput.IsPresent
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [System.Diagnostics.Process]::Start($info)
    $owned.Add($process)
    if ($CaptureOutput) {
        # Drain both pipes concurrently so a parser/parameter error cannot block
        # on a full output pipe. Only the bounded diagnostic excerpts are saved.
        $workerOutput[$process.Id] = @{
            stdout = $process.StandardOutput.ReadToEndAsync()
            stderr = $process.StandardError.ReadToEndAsync()
        }
    }
    return $process
}

function Assert-SmokeDeadline {
    if ($runClock.Elapsed.TotalSeconds -ge $OverallTimeoutSeconds) {
        throw "The smoke run exceeded its overall $OverallTimeoutSeconds second deadline."
    }
}

function Get-AppTree {
    $rows = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate -OperationTimeoutSec 5)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($app.Id)
    do {
        $added = $false
        foreach ($row in $rows) {
            if ($ids.Contains([int]$row.ParentProcessId) -and -not $ids.Contains([int]$row.ProcessId) -and
                $null -ne $row.CreationDate -and $row.CreationDate.ToUniversalTime() -ge $app.StartTime.ToUniversalTime()) {
                [void]$ids.Add([int]$row.ProcessId)
                $added = $true
            }
        }
    } while ($added)
    $tree = @()
    foreach ($row in $rows) {
        if (-not $ids.Contains([int]$row.ProcessId)) { continue }
        try {
            $process = [System.Diagnostics.Process]::GetProcessById([int]$row.ProcessId)
            $identity = $process.StartTime.ToUniversalTime().Ticks
            $observed[[int]$row.ProcessId] = $identity
            $tree += [pscustomobject]@{
                Process = $process; ParentId = [int]$row.ParentProcessId; StartedTicks = $identity
            }
        } catch { } # A short-lived helper may have already exited.
    }
    return $tree
}

function Get-MemorySample([string]$Stage) {
    $tree = @(Get-AppTree)
    $counters = @{}
    $counterError = $null
    try {
        foreach ($counter in Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -OperationTimeoutSec 5) {
            $counters[[int]$counter.IDProcess] = $counter
        }
    } catch { $counterError = 'Private working set counters were unavailable.' }
    $processes = @()
    foreach ($item in $tree) {
        $process = $item.Process
        try {
            $process.Refresh()
            if ($process.HasExited -or $process.StartTime.ToUniversalTime().Ticks -ne $item.StartedTicks) { continue }
            $counter = $counters[$process.Id]
            $privateWorkingSet = $null
            if ($null -ne $counter -and $null -ne $counter.PSObject.Properties['WorkingSetPrivate']) {
                $privateWorkingSet = [long]$counter.WorkingSetPrivate
            }
            $version = $null
            if ($process.ProcessName -eq 'msedgewebview2') {
                try { $version = $process.MainModule.FileVersionInfo.ProductVersion } catch { }
            }
            $processes += [pscustomobject]@{
                pid = $process.Id; parentPid = $item.ParentId; name = $process.ProcessName
                workingSetBytes = $process.WorkingSet64
                privateBytes = $process.PrivateMemorySize64
                privateWorkingSetBytes = $privateWorkingSet
                totalCpuMs = [Math]::Round($process.TotalProcessorTime.TotalMilliseconds, 2)
                webview2Version = $version
            }
        } catch { } # Exited processes contribute no current resident memory.
    }
    $complete = $processes.Count -gt 0 -and @($processes | Where-Object { $null -eq $_.privateWorkingSetBytes }).Count -eq 0
    $privateTotal = $null
    if ($complete) { $privateTotal = [long]($processes | Measure-Object -Property privateWorkingSetBytes -Sum).Sum }
    return [pscustomobject]@{
        stage = $Stage; sampledAtUtc = [DateTime]::UtcNow.ToString('o')
        processCount = $processes.Count
        webview2ProcessCount = @($processes | Where-Object name -eq 'msedgewebview2').Count
        workingSetBytes = [long]($processes | Measure-Object -Property workingSetBytes -Sum).Sum
        privateBytes = [long]($processes | Measure-Object -Property privateBytes -Sum).Sum
        privateWorkingSetBytes = $privateTotal
        privateWorkingSetComplete = $complete
        counterError = $counterError
        processes = $processes
    }
}

function Get-ProbeEvidence([string]$ProbeFile, [bool]$TimedOut, [System.Diagnostics.Process]$Worker) {
    $progressPath = $ProbeFile + '.progress.json'
    $evidence = [ordered]@{
        timedOut = $TimedOut; lastPhase = 'worker-not-started'; progress = $null
        file = [System.IO.Path]::GetFileName($progressPath)
        exitCode = $null; stdout = $null; stderr = $null; result = $null
    }
    if ($Worker.HasExited) {
        $evidence.exitCode = $Worker.ExitCode
        $streams = $workerOutput[$Worker.Id]
        if ($null -ne $streams) {
            foreach ($streamName in @('stdout', 'stderr')) {
                $read = $streams[$streamName]
                if ($read.Wait(1000)) {
                    $text = $read.GetAwaiter().GetResult()
                    if ($text.Length -gt 0) {
                        $text = $text.Substring(0, [Math]::Min(16384, $text.Length))
                        $path = $ProbeFile + '.' + $streamName + '.txt'
                        [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
                        $evidence[$streamName] = [pscustomobject]@{
                            file = [System.IO.Path]::GetFileName($path)
                            preview = $text.Substring(0, [Math]::Min(2048, $text.Length))
                        }
                    }
                }
            }
        }
    }
    if ([System.IO.File]::Exists($progressPath)) {
        try {
            $progress = Get-Content -Raw -LiteralPath $progressPath | ConvertFrom-Json
            $evidence.lastPhase = $progress.lastPhase
            $evidence.progress = $progress
        } catch { $evidence.lastPhase = 'progress-read-unavailable' }
    }
    if ([System.IO.File]::Exists($ProbeFile)) {
        try { $evidence.result = Get-Content -Raw -LiteralPath $ProbeFile | ConvertFrom-Json } catch { }
    }
    return [pscustomobject]$evidence
}

function Capture-FailedWindow {
    if ($NoScreenshot -or $null -eq $app) { return }
    $app.Refresh()
    if ($app.HasExited -or $app.MainWindowHandle -eq [IntPtr]::Zero) { return }
    # Independent of UIA: an accessibility-provider hang must not hide the
    # visible app state. This worker still verifies the window's owning PID.
    $probeFile = Join-Path $out 'failure-window-probe.json'
    $arguments = @('-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
        '-Probe', '-ProbeAction', 'screenshot', '-WindowHandle', $app.MainWindowHandle.ToInt64().ToString(),
        '-OwnerProcessId', $app.Id.ToString(), '-ProbeOutput', $probeFile,
        '-ScreenshotPath', (Join-Path $out 'failure-window.png'))
    $worker = Start-OwnedProcess $workerShell $arguments $out -CaptureOutput
    $timedOut = -not $worker.WaitForExit(8000)
    if ($timedOut) { $worker.Kill($true); [void]$worker.WaitForExit(2000) }
    $metrics.probes += Get-ProbeEvidence $probeFile $timedOut $worker
    if ([System.IO.File]::Exists($probeFile)) {
        $result = Get-Content -Raw -LiteralPath $probeFile | ConvertFrom-Json
        $metrics.failureScreenshot = $result.screenshot
    }
}

function Wait-ForHeading([string]$Heading, [string]$ScreenshotName) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $lastReason = 'No accessibility result was returned.'
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Assert-SmokeDeadline
        $app.Refresh()
        if ($app.HasExited) { throw 'The application exited before the document rendered.' }
        $probeFile = Join-Path $out ('probe-' + [Guid]::NewGuid().ToString('N') + '.json')
        $arguments = @('-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
            '-Probe', '-WindowHandle', $app.MainWindowHandle.ToInt64().ToString(),
            '-OwnerProcessId', $app.Id.ToString(),
            '-ExpectedHeading', $Heading, '-ProbeOutput', $probeFile)
        if (-not $NoScreenshot) { $arguments += @('-ScreenshotPath', (Join-Path $out $ScreenshotName)) }
        $worker = Start-OwnedProcess $workerShell $arguments $out -CaptureOutput
        $remaining = [Math]::Max(1, [int](($TimeoutSeconds - $watch.Elapsed.TotalSeconds) * 1000))
        $timedOut = -not $worker.WaitForExit([Math]::Min(8000, $remaining))
        if ($timedOut) {
            $worker.Kill($true)
            [void]$worker.WaitForExit(2000)
        }
        $evidence = Get-ProbeEvidence $probeFile $timedOut $worker
        $metrics.probes += $evidence
        if ($timedOut) {
            $lastReason = 'The UI Automation worker timed out at phase: ' + $evidence.lastPhase
        } elseif (Test-Path -LiteralPath $probeFile) {
            $result = Get-Content -Raw -LiteralPath $probeFile | ConvertFrom-Json
            if ($result.found) { return $result }
            $lastReason = $result.reason
        } else {
            throw "The UI Automation worker exited with code $($evidence.exitCode) before returning a probe. See its captured stdout/stderr."
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Rendered heading was not verified within $TimeoutSeconds seconds. $lastReason"
}

function Invoke-SmokeAction([string]$Action, [string]$Name = '', [string]$Destination = '') {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $lastReason = 'No accessibility result was returned.'
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Assert-SmokeDeadline
        $app.Refresh()
        if ($app.HasExited) { throw 'The application exited during native export verification.' }
        $probeFile = Join-Path $out ('probe-' + [Guid]::NewGuid().ToString('N') + '.json')
        $arguments = @('-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
            '-Probe', '-ProbeAction', $Action, '-WindowHandle', $app.MainWindowHandle.ToInt64().ToString(),
            '-OwnerProcessId', $app.Id.ToString(), '-ProbeOutput', $probeFile)
        if ($Name) { $arguments += @('-ButtonName', $Name) }
        if ($Destination) { $arguments += @('-SavePath', $Destination) }
        $worker = Start-OwnedProcess $workerShell $arguments $out -CaptureOutput
        $attempt = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not (Test-Path -LiteralPath $probeFile) -and -not $worker.HasExited -and
            $attempt.Elapsed.TotalSeconds -lt 8 -and $watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
            Start-Sleep -Milliseconds 100
        }
        if (Test-Path -LiteralPath $probeFile) {
            $result = Get-Content -Raw -LiteralPath $probeFile | ConvertFrom-Json
            $metrics.probes += Get-ProbeEvidence $probeFile $false $worker
            if ($result.found) { return }
            $lastReason = $result.reason
        } else {
            $evidence = Get-ProbeEvidence $probeFile (-not $worker.HasExited) $worker
            $metrics.probes += $evidence
            if ($worker.HasExited) {
                throw "The UI Automation worker exited with code $($evidence.exitCode) before returning a probe. See its captured stdout/stderr."
            }
        }
        if (-not $worker.HasExited) { $worker.Kill($true); [void]$worker.WaitForExit(2000) }
        Start-Sleep -Milliseconds 200
    }
    throw "Native UI action '$Action' ('$Name') did not become available before the timeout. $lastReason"
}

function Wait-ExportFile([string]$Path, [scriptblock]$Validate) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Assert-SmokeDeadline
        if ([System.IO.File]::Exists($Path)) {
            try {
                $bytes = [System.IO.File]::ReadAllBytes($Path)
                if (& $Validate $bytes) {
                    return [pscustomobject]@{
                        bytes = $bytes.Length
                        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
                        file = [System.IO.Path]::GetRelativePath($out, $Path).Replace('\', '/')
                    }
                }
            } catch [System.IO.IOException] { } # The writer may still hold its file handle.
        }
        Start-Sleep -Milliseconds 200
    }
    throw 'The native export did not produce the expected complete file before the timeout.'
}

try {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($exe)
    if (@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count -gt 0) {
        throw 'An application process with this name is already running. Close it before this isolated smoke run.'
    }
    $fixtureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('MDviewer smoke ' + [Guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($fixtureDirectory)
    $firstName = "first caf$([char]0x00e9) $([char]0x6587)$([char]0x4ef6).md"
    $secondName = "second caf$([char]0x00e9) $([char]0x6587)$([char]0x4ef6).markdown"
    $firstHeading = 'MDviewer native first heading'
    $secondHeading = 'MDviewer native forwarded heading'
    [System.IO.File]::WriteAllText((Join-Path $fixtureDirectory $firstName),
        "# $firstHeading`n`nA **rendered** Markdown document with a Unicode filename.`n", [System.Text.UTF8Encoding]::new($false))
    $secondText = "# $secondHeading`n`nThis document arrived through the second native launch.`n"
    [System.IO.File]::WriteAllText((Join-Path $fixtureDirectory $secondName), $secondText, [System.Text.Encoding]::Unicode)
    $launch = [System.Diagnostics.Stopwatch]::StartNew()
    $app = Start-OwnedProcess $exe @((Join-Path $fixtureDirectory $firstName)) ([System.IO.Path]::GetDirectoryName($exe))
    while ($launch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Assert-SmokeDeadline
        $app.Refresh()
        if ($app.HasExited) { throw 'The executable exited before creating its main window. Check WebView2 installation.' }
        if ($app.MainWindowHandle -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    }
    if ($app.MainWindowHandle -eq [IntPtr]::Zero) { throw 'The application did not create a main window before the timeout.' }
    $windowMs = [Math]::Round($launch.Elapsed.TotalMilliseconds, 2)
    $metrics.firstLaunch = [ordered]@{
        windowCreated = $true; headingVerified = $false; pid = $app.Id
        sessionId = $app.SessionId; launchToWindowMs = $windowMs
    }
    $firstProbe = Wait-ForHeading $firstHeading 'first-document.png'
    $metrics.firstLaunch = [ordered]@{
        windowCreated = $true; headingVerified = $true; pid = $app.Id
        sessionId = $app.SessionId
        argumentKind = 'absolute Unicode path with spaces; UTF-8 document'
        launchToWindowMs = $windowMs
        launchToVerifiedHeadingMs = [Math]::Round($launch.Elapsed.TotalMilliseconds, 2)
        screenshot = $firstProbe.screenshot
    }
    Start-Sleep -Seconds $SettleSeconds
    $metrics.samples += Get-MemorySample 'first-document'

    $forward = [System.Diagnostics.Stopwatch]::StartNew()
    # This launch intentionally supplies a relative Unicode path from a different cwd.
    $second = Start-OwnedProcess $exe @($secondName) $fixtureDirectory
    if (-not $second.WaitForExit([Math]::Min(15000, $TimeoutSeconds * 1000))) {
        throw 'The second launch stayed alive instead of forwarding to the existing instance.'
    }
    if ($second.ExitCode -ne 0) { throw 'The second launch failed while forwarding its document.' }
    $exitMs = [Math]::Round($forward.Elapsed.TotalMilliseconds, 2)
    $secondProbe = Wait-ForHeading $secondHeading 'forwarded-document.png'
    $hosts = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
    if ($hosts.Count -ne 1 -or $hosts[0].Id -ne $app.Id) { throw 'Single-instance verification found an unexpected host process.' }
    $metrics.secondLaunch = [ordered]@{
        secondProcessExited = $true; exitCode = $second.ExitCode; headingVerified = $true
        originalHostRetained = $true; hostProcessCount = $hosts.Count
        argumentKind = 'relative Unicode path with spaces; UTF-16LE BOM document'
        launchToExitMs = $exitMs
        launchToVerifiedHeadingMs = [Math]::Round($forward.Elapsed.TotalMilliseconds, 2)
        screenshot = $secondProbe.screenshot
    }
    Start-Sleep -Seconds $SettleSeconds
    $metrics.samples += Get-MemorySample 'forwarded-document'

    # Reader measurements are complete before loading the optional editor/PDF path.
    $exportDirectory = Join-Path $out ('exports-' + [Guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($exportDirectory)
    $markdownPath = Join-Path $exportDirectory 'saved-source.md'
    $pdfPath = Join-Path $exportDirectory 'saved-document.pdf'
    $expectedSourceBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($secondText)
    Invoke-SmokeAction 'button' 'Edit & PDF'
    Invoke-SmokeAction 'button' 'Save Markdown'
    Invoke-SmokeAction 'save-dialog' -Destination $markdownPath
    $markdownEvidence = Wait-ExportFile $markdownPath {
        param([byte[]]$bytes)
        $bytes.Length -eq $expectedSourceBytes.Length -and
            [Convert]::ToBase64String($bytes) -ceq [Convert]::ToBase64String($expectedSourceBytes)
    }
    Invoke-SmokeAction 'button' 'Download PDF'
    Invoke-SmokeAction 'save-dialog' -Destination $pdfPath
    $pdfEvidence = Wait-ExportFile $pdfPath {
        param([byte[]]$bytes)
        $bytes.Length -gt 5 -and [System.Text.Encoding]::ASCII.GetString($bytes, 0, 5) -ceq '%PDF-' -and
            [System.Text.Encoding]::ASCII.GetString($bytes, [Math]::Max(0, $bytes.Length - 1024), [Math]::Min(1024, $bytes.Length)).Contains('%%EOF')
    }
    $metrics.exports = [ordered]@{
        workspaceOpened = $true
        nativeSaveDialogsVerified = 2
        markdownExactUtf8Bytes = $true
        markdown = $markdownEvidence
        pdfHeaderAndEofVerified = $true
        pdf = $pdfEvidence
    }
    Start-Sleep -Seconds $SettleSeconds
    $metrics.samples += Get-MemorySample 'workspace-after-export'
    $metrics.status = 'passed'
} catch {
    $failure = $_.Exception.Message
    $metrics.status = 'failed'
    $metrics.failure = $failure
    try { Capture-FailedWindow } catch {
        $metrics.failureScreenshot = @{ saved = $false; reason = 'The owned-window diagnostic could not complete.' }
    }
} finally {
    # Refresh ownership while the host is still alive, then terminate its complete tree.
    if ($null -ne $app) {
        try { [void](Get-AppTree) } catch { }
    }
    foreach ($process in $owned) {
        try {
            $process.Refresh()
            if (-not $process.HasExited) { $process.Kill($true); [void]$process.WaitForExit(5000) }
        } catch { $metrics.cleanupErrors += 'An owned process could not be terminated.' }
    }
    # Also handle observed children that exited/reparented during host shutdown.
    foreach ($processId in $observed.Keys) {
        try {
            $process = [System.Diagnostics.Process]::GetProcessById([int]$processId)
            if ($process.StartTime.ToUniversalTime().Ticks -eq $observed[$processId]) { $process.Kill() }
        } catch [System.ArgumentException] { } # Already exited.
        catch { $metrics.cleanupErrors += 'An observed child process could not be terminated.' }
    }
    if ($fixtureDirectory) {
        try { Remove-Item -LiteralPath $fixtureDirectory -Recurse -Force } catch {
            $metrics.cleanupErrors += 'Temporary smoke fixtures could not be removed.'
        }
    }
    if ($metrics.cleanupErrors.Count -gt 0 -and -not $failure) {
        $failure = 'The smoke run could not clean up every owned process or fixture.'
        $metrics.status = 'failed'
        $metrics.failure = $failure
    }
    $metrics.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
    $metricsPath = Join-Path $out 'metrics.json'
    [System.IO.File]::WriteAllText($metricsPath, ($metrics | ConvertTo-Json -Depth 9), [System.Text.UTF8Encoding]::new($false))
    Write-Host "Desktop smoke $($metrics.status). Metrics: $metricsPath"
}
if ($failure) { throw "Desktop smoke failed: $failure" }
