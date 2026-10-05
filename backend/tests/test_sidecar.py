"""Exercise backend ownership with real processes, optionally a packaged binary."""

import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.name == "posix", "Process-group checks require POSIX")
class SidecarLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="gazette-lifecycle-")
        self.addCleanup(self.directory.cleanup)
        self.log_path = Path(self.directory.name) / "backend.log"
        self.log = self.log_path.open("wb")
        self.addCleanup(self.log.close)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.token = str(uuid.uuid4())
        self.environment = {
            **os.environ,
            "DEEP_WEBSEARCH_TOKEN": self.token,
            "TMPDIR": self.directory.name,
        }
        binary = os.environ.get("SIDECAR_TEST_BINARY")
        self.command = [binary] if binary else [sys.executable, "-m", "backend.sidecar"]
        self.command += ["--port", str(self.port), "--parent-stdin"]
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.process = None

    def start(self, command=None):
        self.process = subprocess.Popen(
            command or self.command,
            cwd=ROOT,
            env=self.environment,
            stdin=subprocess.PIPE,
            stdout=self.log,
            stderr=self.log,
            start_new_session=True,
        )
        self.addCleanup(self.stop_test_processes)
        return self.process

    def group_members(self):
        output = subprocess.check_output(
            ["ps", "-axo", "pid=,pgid=,state="], text=True
        )
        return [
            int(pid)
            for pid, group, state in (line.split() for line in output.splitlines())
            if int(group) == self.process.pid and not state.startswith("Z")
        ]

    def stop_test_processes(self):
        if self.group_members():
            os.killpg(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=5)
        self.process.stdin.close()

    def healthy(self):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/health",
            headers={"X-Backend-Token": self.token},
        )
        try:
            with self.opener.open(request, timeout=0.5) as response:
                return response.status == 200
        except OSError:
            return False

    def wait_until_ready(self):
        deadline = time.monotonic() + 30
        while not self.healthy():
            self.assertIsNone(
                self.process.poll(), self.log_path.read_text(errors="replace")
            )
            self.assertLess(time.monotonic(), deadline, "Backend startup timed out")
            time.sleep(0.1)

    def assert_stopped(self, graceful=True, timeout=12):
        self.process.wait(timeout=timeout)
        deadline = time.monotonic() + 2
        while self.group_members() and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertEqual(self.group_members(), [], "Backend left a child process alive")
        self.assertFalse(self.healthy())
        if graceful:
            self.assertIn("Application shutdown complete", self.log_path.read_text())

    def test_shutdown_command_stops_the_entire_backend(self):
        process = self.start()
        self.wait_until_ready()
        process.stdin.write(b"shutdown\n")
        process.stdin.flush()
        self.assert_stopped()
        self.assertEqual(process.returncode, 0)

    def test_closed_desktop_pipe_stops_the_entire_backend(self):
        process = self.start()
        self.wait_until_ready()
        process.stdin.close()
        self.assert_stopped()

    def test_force_quitting_desktop_owner_stops_the_entire_backend(self):
        # This process owns the pipe exactly as the desktop host does. Killing
        # it must terminate both the onefile launcher and its Python child.
        owner_code = (
            "import subprocess, sys, time; "
            "child = subprocess.Popen(sys.argv[1:], stdin=subprocess.PIPE); "
            "time.sleep(60)"
        )
        process = self.start([sys.executable, "-c", owner_code, *self.command])
        self.wait_until_ready()
        process.kill()
        self.assert_stopped()

    def test_quitting_during_startup_does_not_leave_a_backend(self):
        process = self.start()
        process.stdin.close()
        # The control reader starts after onefile extraction/Python loading.
        self.assert_stopped(graceful=False, timeout=30)

    def test_shutdown_deadline_stops_a_blocked_python_process(self):
        # Model a server/import that never returns: the reader must enforce its
        # deadline independently of the event loop or application shutdown hooks.
        blocked_code = (
            "import sys, time; import backend.sidecar as sidecar; "
            "sidecar.HARD_SHUTDOWN_SECONDS = 0.2; "
            "sidecar.DesktopConnection(sys.stdin).start(); time.sleep(60)"
        )
        process = self.start([sys.executable, "-c", blocked_code])
        process.stdin.close()
        self.assert_stopped(graceful=False)
        self.assertEqual(process.returncode, 1)


if __name__ == "__main__":
    unittest.main()
