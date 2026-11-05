# Pure deadline policy shared by the native smoke parent and its regression tests.
# Readiness is a one-time observation, not an inactivity timer: phase updates never
# renew a budget. The caller retains RuntimeReadyAtMs across every poll.
function Get-SmokeProbeWaitDecision {
    param(
        [double]$ElapsedMs,
        [double]$RuntimeReadyAtMs = -1,
        [double]$OperationRemainingMs,
        [double]$OverallRemainingMs,
        [double]$BootstrapTimeoutMs = 30000,
        [double]$WorkerOperationTimeoutMs = 8000,
        [bool]$HasExited = $false,
        [bool]$HasResult = $false,
        [bool]$ReturnOnResult = $false
    )
    if ($OverallRemainingMs -le 0) { return 'overall-timeout' }
    if ($OperationRemainingMs -le 0) { return 'operation-timeout' }
    if (($RuntimeReadyAtMs -lt 0 -and $ElapsedMs -ge $BootstrapTimeoutMs) -or
        $RuntimeReadyAtMs -gt $BootstrapTimeoutMs) { return 'bootstrap-timeout' }
    if ($RuntimeReadyAtMs -ge 0 -and
        $ElapsedMs - $RuntimeReadyAtMs -ge $WorkerOperationTimeoutMs) { return 'worker-operation-timeout' }
    if ($ReturnOnResult -and $HasResult) { return 'result' }
    if ($HasExited) { return 'exited' }
    return 'wait'
}
