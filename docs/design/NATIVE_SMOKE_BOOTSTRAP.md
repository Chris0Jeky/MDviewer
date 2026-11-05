# Bounded native smoke worker startup

## Finding and scope

The two exact-head PR #208 Windows attempts in run
[42078633313](https://github.com/Chris0Jeky/MDviewer/actions/runs/42078633313)
built the executable/installer and created the application window. Each heading
probe was then killed at the fixed eight-second worker deadline with
`worker-not-started`, no result and no captured stdout/stderr. One independent
failure screenshot worker reached `compiling-screenshot-helper` before the same
cutoff. The unchanged native application/harness passed the docs-only PR #209 run
[42080261726](https://github.com/Chris0Jeky/MDviewer/actions/runs/42080261726).

These observations implicate worker/framework startup as an intermittent harness
failure. They do not establish a rendered document, prove the reason a runner was
slow, or excuse an application failure. Repeatedly replacing a cold worker after
eight seconds can prevent the probe from reaching the assertion at all.

This change is limited to the smoke harness and its diagnostics. It changes no
application behavior, file capability, native Save bridge, workflow, release gate,
memory threshold or application startup claim.

## Deadline contract

| Boundary | Limit | Start and behavior |
| --- | --- | --- |
| Worker bootstrap | 30 seconds | Process launch observation through PowerShell startup, framework loading and required helper compilation |
| Worker operation | 8 seconds | First parent observation of `runtime-ready`; subsequent phases never reset it |
| Heading/native action | Existing 45 seconds by default | Entire caller operation, including all worker startup and completed negative-result polling |
| Whole smoke | Existing 180 seconds by default | Always caps bootstrap and operation waits; failure screenshots only use remaining budget |

`runtime-ready` is emitted only after UI Automation assemblies and the per-action
Save/screenshot helper have loaded. `AutomationElement.FromHandle`, UI queries,
native control validation, filename mutation, button invocation and screenshot
capture happen after readiness. This avoids treating helper compilation as a hung
UI query. The parent keeps the original readiness observation across phase changes
and temporary progress-file replacement gaps.

A bootstrap, worker-operation, caller-operation or overall timeout terminates the
owned worker and fails immediately with its phase. It does not blindly launch
another worker against unknown UI state. Only a completed negative UI result
continues the existing bounded readiness polling. A published successful action
attempt may still precede the return of a modal Invoke call; the following native
dialog and saved-file checks remain required.

Failure screenshot protocol files are unique to the attempt, so a previous run's
ready/result JSON cannot affect a new deadline. When the overall budget is already
exhausted, the metrics explain why no new diagnostic capture was started. Existing
bounded owned-process cleanup still runs after success or failure.

## Evidence and unchanged assertions

Each probe retains its phase sequence, PowerShell version/apartment/session,
result and bounded stdout/stderr excerpts. It now also records the worker PID,
worker CPU time, process-observed elapsed time, first readiness observation,
timeout decision and remaining caller/overall budgets. These are harness
diagnostics, not application performance benchmarks; accessibility overhead and
worker exclusion from app-memory samples remain explicit.

The smoke still requires both actual rendered headings, the original host after
single-instance forwarding, two actual native Save dialogs with owned controls
and exact filename readback, all expected UTF-8 Markdown bytes, and PDF header/EOF.
No published attempt, window creation, compilation success, or increased wait
substitutes for those assertions. Process ownership, PID/creation-time cleanup and
cleanup-error failure semantics are preserved.

## Verification and required hosted gate

`scripts/test-desktop-probe-wait.ps1` exercises the pure deadline policy without
sleeping, loading UIA or launching the application. Cases cover the old eight-second
bootstrap cutoff, the 30-second cap, late readiness, the unchanged operation cap,
phase-repeat behavior, operation/overall clamping, worker exit, negative/action
result publication, modal invocation, and results arriving after a deadline. The
parent smoke invokes it before launching the real application, so the existing
Windows CI path runs the tests without a workflow change.

```powershell
pwsh -File scripts/test-desktop-probe-wait.ps1
pwsh -File scripts/desktop-smoke.ps1 -Executable src-tauri/target/release/mdviewer.exe -OutputDirectory desktop-artifacts/smoke
```

This managed Linux environment has no PowerShell/.NET runtime or Windows UIA.
Local source/whitespace review cannot establish PowerShell execution or native
success. Exact-head Windows Actions must pass the policy tests and the complete
unchanged native assertions before this reliability change is accepted. If it
fails, its classified phase/elapsed evidence should drive the next diagnosis;
do not replace that evidence with automatic reruns or unbounded waits.
