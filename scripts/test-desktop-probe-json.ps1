<#
Deterministic Windows file-sharing controls for the real probe JSON helpers.
Run separately in Windows PowerShell 5.1 and PowerShell 7. No UIA, sleeps,
application launch, retries, deadline changes, or simulated sharing semantics.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'Probe JSON sharing controls require Windows.'
}
. (Join-Path $PSScriptRoot 'lib/desktop-probe-json.ps1')
$script:probeJsonCheckCount = 0
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
# Keep this script ASCII so Windows PowerShell does not need an encoding hint.
$unicode = ([char]0x65e5).ToString() + [char]0x672c + ' ' +
    [char]::ConvertFromUtf32(0x1f4c4) + ' caf' + [char]0x00e9

function Assert-ProbeJson([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw "Probe JSON assertion failed: $Name" }
    $script:probeJsonCheckCount++
}

function Assert-ProbeJsonThrows([scriptblock]$Action, [type]$ExpectedType, [string]$Name) {
    $caughtFailure = $null
    try { & $Action | Out-Null } catch { $caughtFailure = $_.Exception }
    Assert-ProbeJson ($null -ne $caughtFailure) "$Name must throw"
    # .NET method calls can be wrapped in MethodInvocationException in PowerShell.
    $underlyingFailure = $caughtFailure
    while ($null -ne $underlyingFailure -and -not $ExpectedType.IsInstanceOfType($underlyingFailure)) {
        $underlyingFailure = $underlyingFailure.InnerException
    }
    Assert-ProbeJson ($null -ne $underlyingFailure) "$Name must preserve $($ExpectedType.FullName)"
}

function Read-HeldProbeBytes([System.IO.Stream]$Stream) {
    $Stream.Position = 0
    $copy = [System.IO.MemoryStream]::new()
    try {
        $Stream.CopyTo($copy)
        return ,$copy.ToArray()
    } finally { $copy.Dispose() }
}

function Assert-ProbeBytes([byte[]]$Actual, [byte[]]$Expected, [string]$Name) {
    Assert-ProbeJson ([System.Convert]::ToBase64String($Actual) -ceq
        [System.Convert]::ToBase64String($Expected)) "$Name exact bytes"
}

function New-ProbeSnapshot([string]$Kind, [int]$Generation, [bool]$Ready) {
    return [ordered]@{
        kind = $Kind; generation = $Generation; runtimeReady = $Ready
        runtimeReadyElapsedMs = $(if ($Ready) { 125.5 } else { $null })
        found = $Ready; lastPhase = "$Kind-$Generation"
        text = $unicode; payload = ('x' * (41 + $Generation * 137))
        phases = @([ordered]@{ phase = "$Kind-$Generation"; elapsedMs = $Generation })
        detail = [ordered]@{ message = $unicode; generation = $Generation }
    }
}

function Get-ProbeSnapshotBytes([object]$Value) {
    return ,$utf8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 5))
}

function Assert-PublishedProbe([string]$Path, [object]$Expected, [string]$Name) {
    $actual = Read-SmokeProbeJson $Path
    Assert-ProbeJson ($null -ne $actual) "$Name is published"
    Assert-ProbeJson ($actual.generation -eq $Expected.generation) "$Name generation"
    Assert-ProbeJson (($actual.runtimeReady -is [bool]) -and
        ($actual.runtimeReady -eq $Expected.runtimeReady)) "$Name readiness"
    Assert-ProbeJson ($actual.text -ceq $unicode) "$Name Unicode text"
    Assert-ProbeJson (($actual.detail.message -ceq $unicode) -and
        ($actual.detail.generation -eq $Expected.generation)) "$Name complete nested value"
    $readStream = Open-SmokeProbeReadStream $Path
    Assert-ProbeJson ($null -ne $readStream) "$Name fresh stream"
    try { $bytes = Read-HeldProbeBytes $readStream } finally { $readStream.Dispose() }
    Assert-ProbeBytes $bytes (Get-ProbeSnapshotBytes $Expected) $Name
    Assert-ProbeJson (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xef -and
        $bytes[1] -eq 0xbb -and $bytes[2] -eq 0xbf)) "$Name has no UTF-8 BOM"
}

function Assert-ProbeReaderReleased([string]$Path, [string]$Name) {
    # An undisposed read handle conflicts with this exclusive open on Windows.
    $exclusive = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try { Assert-ProbeJson $exclusive.CanRead "$Name releases its read handle" }
    finally { $exclusive.Dispose() }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('MDviewer probe JSON ' + [Guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($testRoot)
$fixtureFailure = $null
try {
    # Progress and early/final action results share the same publication contract.
    foreach ($kind in @('progress', 'result')) {
        $suffix = $(if ($kind -eq 'progress') { '.json.progress.json' } else { '.json' })
        $path = Join-Path $testRoot ('probe ' + [char]0x8a66 + $suffix)
        $zero = New-ProbeSnapshot $kind 0 $false
        $one = New-ProbeSnapshot $kind 1 $true
        $two = New-ProbeSnapshot $kind 2 $true
        Assert-ProbeJson ($null -eq (Open-SmokeProbeReadStream $path)) "$kind initial stream is missing"
        Assert-ProbeJson ($null -eq (Read-SmokeProbeJson $path)) "$kind initial snapshot is missing"
        Write-SmokeProbeJson $path $zero
        Assert-PublishedProbe $path $zero "$kind first publication"

        # Do not read/prefetch the held streams before replacing their files.
        # In-place truncation would therefore change the bytes these handles see.
        $heldZero = Open-SmokeProbeReadStream $path
        $heldOne = $null
        try {
            Write-SmokeProbeJson $path $one
            Assert-ProbeBytes (Read-HeldProbeBytes $heldZero) (Get-ProbeSnapshotBytes $zero) "$kind held generation zero"
            Assert-PublishedProbe $path $one "$kind replacement one"
            $heldOne = Open-SmokeProbeReadStream $path
            Write-SmokeProbeJson $path $two
            Assert-ProbeBytes (Read-HeldProbeBytes $heldZero) (Get-ProbeSnapshotBytes $zero) "$kind old handle after two replacements"
            Assert-ProbeBytes (Read-HeldProbeBytes $heldOne) (Get-ProbeSnapshotBytes $one) "$kind held generation one"
            Assert-PublishedProbe $path $two "$kind replacement two"
            Assert-ProbeJson (-not [System.IO.File]::Exists($path + '.writing')) "$kind success consumes staging"
        } finally {
            if ($null -ne $heldOne) { $heldOne.Dispose() }
            if ($null -ne $heldZero) { $heldZero.Dispose() }
        }
        Assert-ProbeReaderReleased $path "$kind successful parse"
    }

    $blockedPath = Join-Path $testRoot 'blocked-result.json'
    $before = New-ProbeSnapshot 'result' 0 $false
    $after = New-ProbeSnapshot 'result' 1 $true
    Write-SmokeProbeJson $blockedPath $before
    # Reproduce the old reader's missing delete-sharing permission deterministically.
    $blockingReader = [System.IO.File]::Open($blockedPath, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        Assert-ProbeJsonThrows { [System.IO.File]::Delete($blockedPath) } ([System.IO.IOException]) 'legacy delete against a held reader'
        Assert-ProbeJsonThrows { Write-SmokeProbeJson $blockedPath $after } ([System.IO.IOException]) 'blocked replacement'
        Assert-PublishedProbe $blockedPath $before 'failed replacement retains the published false-readiness snapshot'
        Assert-ProbeBytes (Read-HeldProbeBytes $blockingReader) (Get-ProbeSnapshotBytes $before) 'failed replacement retains held bytes'
        # Failed staging may remain as bounded diagnostics; it is never the public result.
    } finally { $blockingReader.Dispose() }
    Write-SmokeProbeJson $blockedPath $after
    Assert-PublishedProbe $blockedPath $after 'replacement after releasing the blocking reader'
    Assert-ProbeJson (-not [System.IO.File]::Exists($blockedPath + '.writing')) 'successful recovery consumes staging'

    # An existing but inaccessible file is an error, not an unpublished snapshot.
    $missingDirectoryPathForPoll = Join-Path $testRoot 'absent-poll-directory/probe.json'
    $exclusiveReader = [System.IO.File]::Open($blockedPath, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
    try {
        Assert-ProbeJsonThrows { Open-SmokeProbeReadStream $blockedPath } ([System.IO.IOException]) 'locked snapshot open'
        Assert-ProbeJsonThrows { Read-SmokeProbeJson $blockedPath } ([System.IO.IOException]) 'locked snapshot parse'
        # Polling treats only the sharing window as "no new snapshot this tick".
        Assert-ProbeJson ($null -eq (Read-SmokeProbeProgressJson $blockedPath)) 'locked progress poll skips the tick'
    } finally { $exclusiveReader.Dispose() }
    Assert-PublishedProbe $blockedPath $after 'progress poll leaves the snapshot readable'
    Assert-ProbeJson ($null -ne (Read-SmokeProbeProgressJson $blockedPath)) 'released progress poll reads the snapshot'
    Assert-ProbeJsonThrows { Read-SmokeProbeProgressJson $missingDirectoryPathForPoll } ([System.IO.DirectoryNotFoundException]) 'progress poll keeps other failures'
    $missingDirectoryPath = Join-Path $testRoot 'absent-directory/probe.json'
    Assert-ProbeJsonThrows { Read-SmokeProbeJson $missingDirectoryPath } ([System.IO.DirectoryNotFoundException]) 'missing directory'

    $invalidPath = Join-Path $testRoot 'invalid.json'
    foreach ($invalidJson in @('', 'null', 'true', '42', '"scalar"', '[]', '[{"runtimeReady":true}]', '{')) {
        [System.IO.File]::WriteAllText($invalidPath, $invalidJson, $utf8)
        Assert-ProbeJsonThrows { Read-SmokeProbeJson $invalidPath } ([System.Exception]) "invalid object snapshot '$invalidJson'"
        Assert-ProbeReaderReleased $invalidPath 'failed JSON parse'
    }
    [System.IO.File]::WriteAllBytes($invalidPath, [byte[]]@(123, 34, 120, 34, 58, 34, 255, 34, 125))
    Assert-ProbeJsonThrows { Read-SmokeProbeJson $invalidPath } ([System.Text.DecoderFallbackException]) 'invalid UTF-8 snapshot'
    Assert-ProbeReaderReleased $invalidPath 'failed UTF-8 decode'
} catch {
    $fixtureFailure = $_
} finally {
    try { [System.IO.Directory]::Delete($testRoot, $true) }
    catch {
        if ($null -ne $fixtureFailure) {
            throw [System.AggregateException]::new('Probe JSON fixture and cleanup both failed.',
                [System.Exception[]]@($fixtureFailure.Exception, $_.Exception))
        }
        throw
    }
}
if ($null -ne $fixtureFailure) { throw $fixtureFailure }
Write-Host "Desktop probe JSON publication passed $script:probeJsonCheckCount assertions in PowerShell $($PSVersionTable.PSVersion)."
