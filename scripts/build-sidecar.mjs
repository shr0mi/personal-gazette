import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const python = join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

if (!existsSync(python)) {
  console.error("Local Python environment missing. Run npm run setup:python first.");
  process.exit(1);
}

const triple = execFileSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8",
}).trim();
if (!triple) throw new Error("Could not determine the Rust host target triple");

const buildDir = join(root, ".build", "pyinstaller");
const binaryDir = join(root, "src-tauri", "binaries");
mkdirSync(buildDir, { recursive: true });
mkdirSync(binaryDir, { recursive: true });

const result = spawnSync(
  python,
  [
    "-m", "PyInstaller",
    "--noconfirm",
    "--onefile",
    "--collect-submodules", "uvicorn",
    "--collect-data", "trafilatura",
    "--collect-data", "justext",
    "--collect-data", "tld",
    "--collect-data", "litellm",
    "--copy-metadata", "litellm",
    "--hidden-import", "litellm.main",
    "--hidden-import", "litellm.exceptions",
    "--hidden-import", "tiktoken_ext.openai_public",
    "--paths", root,
    "--name", `deep-websearch-api-${triple}`,
    "--distpath", binaryDir,
    "--workpath", buildDir,
    "--specpath", buildDir,
    join(root, "backend", "sidecar.py"),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PYINSTALLER_CONFIG_DIR: join(root, ".build", "pyinstaller-config"),
    },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
