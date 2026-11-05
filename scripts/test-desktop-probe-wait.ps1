<# Pure, deterministic tests; no UIA, sleeping, application launch or process kill. #>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'lib/desktop-probe-wait.ps1')
$script:smokePolicyCaseCount = 0

function Assert-Decision([string]$Name, [hashtable]$Patch, [string]$Expected) {
    $arguments = @{
        ElapsedMs = 0; RuntimeReadyAtMs = -1; OperationRemainingMs = 45000
        OverallRemainingMs = 180000; HasExited = $false; HasResult = $false; ReturnOnResult = $false
    }
    foreach ($key in $Patch.Keys) { $arguments[$key] = $Patch[$key] }
    $actual = Get-SmokeProbeWaitDecision @arguments
    if ($actual -cne $Expected) { throw "Probe deadline policy '$Name': expected '$Expected', got '$actual'." }
    $script:smokePolicyCaseCount++
}

Assert-Decision 'cold worker survives the old eight-second cutoff' @{ ElapsedMs = 8000 } 'wait'
Assert-Decision 'bootstrap remains bounded before readiness' @{ ElapsedMs = 30000 } 'bootstrap-timeout'
Assert-Decision 'late readiness cannot evade the bootstrap cap' @{ ElapsedMs = 31000; RuntimeReadyAtMs = 31000 } 'bootstrap-timeout'
Assert-Decision 'ready at the bootstrap boundary gets its operation budget' @{ ElapsedMs = 30000; RuntimeReadyAtMs = 30000 } 'wait'
Assert-Decision 'slow bootstrap does not spend the UI-operation budget' @{ ElapsedMs = 29000; RuntimeReadyAtMs = 28000 } 'wait'
Assert-Decision 'UI operation retains its eight-second bound' @{ ElapsedMs = 36000; RuntimeReadyAtMs = 28000 } 'worker-operation-timeout'
# The caller supplies the original readiness timestamp despite any phase repeats.
foreach ($elapsed in @(1000, 2000, 7999)) {
    Assert-Decision 'phase repeats do not reset readiness' @{ ElapsedMs = $elapsed; RuntimeReadyAtMs = 0 } 'wait'
}
Assert-Decision 'phase repeats cannot keep a stuck operation alive' @{ ElapsedMs = 8000; RuntimeReadyAtMs = 0 } 'worker-operation-timeout'
Assert-Decision 'operation ceiling clamps bootstrap' @{ ElapsedMs = 12000; OperationRemainingMs = 0 } 'operation-timeout'
Assert-Decision 'overall ceiling clamps bootstrap' @{ ElapsedMs = 12000; OverallRemainingMs = 0 } 'overall-timeout'
Assert-Decision 'overall ceiling clamps ready operation' @{ ElapsedMs = 12000; RuntimeReadyAtMs = 11000; OverallRemainingMs = 0 } 'overall-timeout'
Assert-Decision 'overall ceiling wins over every other timeout' @{ ElapsedMs = 45000; OperationRemainingMs = 0; OverallRemainingMs = 0 } 'overall-timeout'
Assert-Decision 'completed worker exits normally' @{ ElapsedMs = 1000; RuntimeReadyAtMs = 500; HasExited = $true } 'exited'
Assert-Decision 'early bootstrap failure is observed without waiting' @{ ElapsedMs = 1000; HasExited = $true } 'exited'
Assert-Decision 'published action result can precede modal Invoke return' @{ ElapsedMs = 1000; RuntimeReadyAtMs = 500; HasResult = $true; ReturnOnResult = $true } 'result'
Assert-Decision 'negative action result returns to the caller for state polling' @{ ElapsedMs = 1000; RuntimeReadyAtMs = 500; HasResult = $true; ReturnOnResult = $true } 'result'
Assert-Decision 'heading still requires worker completion' @{ ElapsedMs = 1000; RuntimeReadyAtMs = 500; HasResult = $true } 'wait'
Assert-Decision 'a result cannot override the operation deadline' @{ ElapsedMs = 8000; RuntimeReadyAtMs = 0; HasResult = $true; ReturnOnResult = $true } 'worker-operation-timeout'
Assert-Decision 'a result cannot override the overall deadline' @{ ElapsedMs = 1000; RuntimeReadyAtMs = 500; HasResult = $true; ReturnOnResult = $true; OverallRemainingMs = 0 } 'overall-timeout'
Write-Host "Desktop probe deadline policy passed $script:smokePolicyCaseCount cases."
