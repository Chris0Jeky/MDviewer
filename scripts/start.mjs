import { spawnSync } from "node:child_process";
import { main } from "./serve.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npmCommand, ["run", "build"], { stdio: "inherit" });

if (build.error) {
  console.error(`Could not run the production build: ${build.error.message}`);
  process.exitCode = 1;
} else if (build.status !== 0) {
  process.exitCode = build.status ?? 1;
} else {
  await main(["--open", ...process.argv.slice(2)]);
}
