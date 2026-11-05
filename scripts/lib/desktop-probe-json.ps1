# JSON snapshots owned by one probe worker. Staging stays beside its destination,
# and readers permit replacement while retaining their complete opened snapshot.
function Write-SmokeProbeJson([string]$Path, [object]$Value) {
    $pending = $Path + '.writing'
    $json = ConvertTo-Json -InputObject $Value -Depth 5
    [System.IO.File]::WriteAllText($pending, $json, [System.Text.UTF8Encoding]::new($false))
    if ([System.IO.File]::Exists($Path)) {
        # The three-argument overload is available in the PS5.1 worker's framework.
        # Never delete the visible snapshot or fall back after a replace failure.
        [System.IO.File]::Replace($pending, $Path, $null)
    } else {
        [System.IO.File]::Move($pending, $Path)
    }
}

function Open-SmokeProbeReadStream([string]$Path) {
    try {
        return [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
            ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    } catch [System.IO.FileNotFoundException] {
        # A new worker has not published its first snapshot yet.
        return $null
    }
}

function Read-SmokeProbeJson([string]$Path) {
    $stream = Open-SmokeProbeReadStream $Path
    if ($null -eq $stream) { return $null }
    $reader = $null
    try {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.UTF8Encoding]::new($false, $true), $false)
        $json = $reader.ReadToEnd()
        if (-not $json.TrimStart().StartsWith('{')) {
            throw [System.IO.InvalidDataException]::new('A probe snapshot must contain one JSON object.')
        }
        return ConvertFrom-Json -InputObject $json -ErrorAction Stop
    } finally {
        if ($null -ne $reader) { $reader.Dispose() } else { $stream.Dispose() }
    }
}
