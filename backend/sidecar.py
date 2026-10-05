"""Executable entry point packaged alongside the Tauri desktop app."""

import argparse
import asyncio
import os
import sys
import threading
from typing import TextIO


GRACEFUL_SHUTDOWN_SECONDS = 5
HARD_SHUTDOWN_SECONDS = 10


class DesktopConnection:
    """The desktop owns stdin's writer, so EOF also detects desktop crashes."""

    def __init__(self, stream: TextIO) -> None:
        self.stream = stream
        self.shutdown_requested = threading.Event()
        self.stopped = threading.Event()

    def start(self) -> None:
        threading.Thread(
            target=self._read_commands, name="desktop-connection", daemon=True
        ).start()

    def _read_commands(self) -> None:
        try:
            for line in self.stream:
                if line.strip() == "shutdown":
                    break
        finally:
            self.shutdown_requested.set()
            # A blocked startup, shutdown hook, or synchronous request must not
            # keep the Python process alive after its desktop owner has exited.
            if not self.stopped.wait(HARD_SHUTDOWN_SECONDS):
                os._exit(1)

    async def watch(self, server) -> None:
        while not self.shutdown_requested.is_set():
            await asyncio.sleep(0.1)
        server.should_exit = True


async def serve(server, connection: DesktopConnection | None) -> None:
    watcher = asyncio.create_task(connection.watch(server)) if connection else None
    try:
        if connection is None or not connection.shutdown_requested.is_set():
            await server.serve()
    finally:
        if watcher:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local FastAPI sidecar")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument(
        "--parent-stdin", action="store_true", help="Stop when the desktop closes stdin"
    )
    args = parser.parse_args()

    if not os.environ.get("DEEP_WEBSEARCH_TOKEN"):
        parser.error("DEEP_WEBSEARCH_TOKEN is required")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    connection = DesktopConnection(sys.stdin) if args.parent_stdin else None
    if connection:
        # Start before application imports so an app closed during startup does
        # not leave a backend waiting indefinitely to finish initialization.
        connection.start()

    try:
        import uvicorn

        from backend.app import app

        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=args.port,
                access_log=False,
                timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
            )
        )
        asyncio.run(serve(server, connection))
    finally:
        if connection:
            connection.stopped.set()


if __name__ == "__main__":
    main()
