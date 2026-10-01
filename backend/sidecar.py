"""Executable entry point packaged alongside the Tauri desktop app."""

import argparse
import os

import uvicorn

from backend.app import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local FastAPI sidecar")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    if not os.environ.get("DEEP_WEBSEARCH_TOKEN"):
        parser.error("DEEP_WEBSEARCH_TOKEN is required")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
