use std::{
    io::{self, BufRead, BufReader, Read, Write},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub struct BackendProcess {
    child: Child,
}

impl BackendProcess {
    pub fn spawn(mut command: Command) -> io::Result<Self> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Isolate the onefile launcher and Python server so a timeout can
            // terminate both without affecting the desktop or other app runs.
            command.process_group(0);
        }
        let mut child = command.spawn()?;
        if let Some(stdout) = child.stdout.take() {
            drain_output(stdout);
        }
        if let Some(stderr) = child.stderr.take() {
            drain_output(stderr);
        }
        Ok(Self { child })
    }

    pub fn shutdown(self) {
        // A cold onefile launch can spend several seconds unpacking/loading
        // Python before it can read the command. The Python watchdog separately
        // bounds shutdown to 10 seconds once the control reader starts.
        self.shutdown_with_timeout(Duration::from_secs(30));
    }

    fn shutdown_with_timeout(mut self, timeout: Duration) {
        if let Some(mut stdin) = self.child.stdin.take() {
            if let Err(error) = stdin.write_all(b"shutdown\n").and_then(|_| stdin.flush()) {
                eprintln!("could not request backend shutdown: {error}");
            }
            // Closing the writer also triggers shutdown if the command cannot
            // be read. PyInstaller must stay alive to reap its child and clean up.
        }
        match self.wait_for_exit(timeout) {
            Ok(true) => return,
            Ok(false) => eprintln!("backend shutdown timed out; stopping its process tree"),
            Err(error) => eprintln!("could not wait for backend shutdown: {error}"),
        }
        if let Err(error) = self.kill_process_tree() {
            eprintln!("could not stop backend process tree: {error}");
        }
        match self.wait_for_exit(Duration::from_secs(2)) {
            Ok(true) => {}
            Ok(false) => eprintln!("backend launcher did not exit after forced termination"),
            Err(error) => eprintln!("could not reap backend launcher: {error}"),
        }
    }

    fn wait_for_exit(&mut self, timeout: Duration) -> io::Result<bool> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait()? {
                eprintln!("sidecar exited: {status}");
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(unix)]
    fn kill_process_tree(&mut self) -> io::Result<()> {
        let group = i32::try_from(self.child.id())
            .map_err(|_| io::Error::other("backend process ID is out of range"))?;
        // SAFETY: spawn created a separate process group whose ID is this child
        // PID. The child is still owned and unreaped, so its PID cannot be reused.
        if unsafe { libc::kill(-group, libc::SIGKILL) } == 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(())
        } else {
            Err(error)
        }
    }

    #[cfg(windows)]
    fn kill_process_tree(&mut self) -> io::Result<()> {
        use std::os::windows::process::CommandExt;
        let status = Command::new("taskkill")
            .args(["/PID", &self.child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other("could not terminate backend process tree"))
        }
    }
}

fn drain_output(output: impl Read + Send + 'static) {
    thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            match line {
                Ok(line) => eprintln!("sidecar: {line}"),
                Err(error) => {
                    eprintln!("could not read backend output: {error}");
                    break;
                }
            }
        }
    });
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;

    fn marker() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("gazette-shutdown-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn graceful_shutdown_allows_launcher_cleanup() {
        let marker = marker();
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "read -r command; [ \"$command\" = shutdown ] || exit 2; sleep 0.1; echo stopped > \"$1\"",
                "lifecycle-test",
            ])
            .arg(&marker);
        let backend = BackendProcess::spawn(command).unwrap();
        backend.shutdown_with_timeout(Duration::from_secs(2));
        assert_eq!(fs::read_to_string(&marker).unwrap().trim(), "stopped");
        fs::remove_file(marker).unwrap();
    }

    #[test]
    fn shutdown_timeout_terminates_launcher_and_child() {
        let marker = marker();
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 60 & echo $! > \"$1\"; wait", "lifecycle-test"])
            .arg(&marker);
        let backend = BackendProcess::spawn(command).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while !marker.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        backend.shutdown_with_timeout(Duration::ZERO);
        let child: i32 = fs::read_to_string(&marker).unwrap().trim().parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        // SAFETY: signal zero only checks whether this test's worker exists.
        while unsafe { libc::kill(child, 0) } == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(unsafe { libc::kill(child, 0) }, -1);
        fs::remove_file(marker).unwrap();
    }

    #[test]
    #[ignore = "requires SIDECAR_TEST_BINARY pointing to a packaged backend"]
    fn packaged_backend_shutdown_leaves_no_processes() {
        use std::net::{TcpListener, TcpStream};

        let binary = std::env::var_os("SIDECAR_TEST_BINARY").expect("SIDECAR_TEST_BINARY");
        for wait_for_startup in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            drop(listener);
            let mut command = Command::new(&binary);
            command
                .args(["--port", &address.port().to_string(), "--parent-stdin"])
                .env("DEEP_WEBSEARCH_TOKEN", uuid::Uuid::new_v4().to_string());
            let backend = BackendProcess::spawn(command).unwrap();
            let group = backend.child.id() as i32;
            if wait_for_startup {
                let deadline = Instant::now() + Duration::from_secs(30);
                while TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_err() {
                    if Instant::now() >= deadline {
                        backend.shutdown();
                        panic!("packaged backend startup timed out");
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
            backend.shutdown();
            // SAFETY: signal zero only checks whether our isolated group exists.
            assert_eq!(unsafe { libc::kill(-group, 0) }, -1);
            assert!(TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_err());
        }
    }
}
