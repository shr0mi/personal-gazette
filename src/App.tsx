import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type BackendHealth = {
  status: string;
  service: string;
};

function App() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkBackend = async () => {
      try {
        const result = await invoke<BackendHealth>("backend_health");
        if (!cancelled) {
          setHealth(result);
          setError(null);
        }
      } catch (cause) {
        if (cancelled) return;
        attempts += 1;
        if (attempts < 60) {
          timer = setTimeout(checkBackend, 500);
        } else {
          setError(String(cause));
        }
      }
    };

    void checkBackend();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <main className="app-shell">
      <div className="eyebrow">Deep Websearch Agent</div>
      <h1>Research starts here.</h1>
      <p className="intro">
        The desktop shell is ready for the search workflow. React renders the
        interface, Rust manages the app, and FastAPI runs as a local sidecar.
      </p>

      <section className="status-card" aria-live="polite">
        <div>
          <h2>Local backend</h2>
          <p>
            {health
              ? `${health.service} is ready.`
              : error
                ? `Could not reach FastAPI: ${error}`
                : "Starting FastAPI sidecar…"}
          </p>
        </div>
        <span
          className={`status-pill ${health ? "ready" : error ? "error" : "starting"}`}
        >
          {health ? "Ready" : error ? "Unavailable" : "Starting"}
        </span>
      </section>

      <p className="next-step">
        Next: add search providers and the research pipeline to the Python API.
      </p>
    </main>
  );
}

export default App;
