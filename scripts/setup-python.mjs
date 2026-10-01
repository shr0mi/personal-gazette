import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const venv = join(root, ".venv");
const python = join(
  venv,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(python)) {
  const systemPython = process.env.PYTHON || (process.platform === "win32" ? "py" : "python3");
  const prefix = process.platform === "win32" && !process.env.PYTHON ? ["-3"] : [];
  run(systemPython, [...prefix, "-m", "venv", venv]);
}

run(python, ["-m", "pip", "install", "-r", "backend/requirements-build.txt"]);
