import { spawnSync } from "node:child_process";

const candidates = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []], ["py", ["-3"]]];

const scriptArgs = process.argv.slice(2);
if (scriptArgs.length === 0) {
  console.error("Usage: node scripts/run-python.mjs <script.py> [arguments...]");
  process.exitCode = 2;
} else {
  let selected;
  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, "--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) {
      selected = [command, prefix];
      break;
    }
  }

  if (!selected) {
    console.error("Python 3 was not found. Install Python and ensure py, python3, or python is available.");
    process.exitCode = 1;
  } else {
    const [command, prefix] = selected;
    const result = spawnSync(command, [...prefix, ...scriptArgs], { stdio: "inherit" });
    if (result.error) {
      console.error(`Could not start Python: ${result.error.message}`);
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
    }
  }
}
