# Deep Websearch Agent

Desktop starter with a React and TypeScript interface, a Tauri/Rust host, and a local FastAPI sidecar. The app currently displays the backend's health; search features are the next step.

## Prerequisites

- Node.js and npm
- Rust with a desktop host target (`rustc --print host-tuple`)
- Python 3.11 or newer with `venv` and `pip`
- The [Tauri desktop prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

Dependencies are installed in this repository's `node_modules` and `.venv`. No global npm, Cargo, or Python package installation is needed.

## Run locally

```sh
npm install
npm run setup:python
npm run dev:desktop
```

`dev:desktop` builds the Python executable and starts Vite and Tauri. PyInstaller's first run may take a few seconds; the interface waits up to 30 seconds for the API to become ready.

## Build a desktop bundle

```sh
npm run build:desktop
```

The build command packages a sidecar for the machine's current Rust host target. Build on each target operating system and architecture; the PyInstaller step is not a cross compiler.

## Project layout

- `src/` — React interface; it calls the `backend_health` Tauri command.
- `src-tauri/` — Rust desktop host; starts, monitors, and stops the sidecar.
- `backend/` — FastAPI app and executable entry point.
- `scripts/` — local Python setup and sidecar packaging.

The Rust host chooses a free loopback port and passes a random token to the sidecar through its environment. The Python API binds to `127.0.0.1`, and `/health` requires that token. The frontend talks through a Tauri command, so it does not need direct network access or the token. Add future API routes in `backend/app.py` and bridge them through Rust commands.
