import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import SettingsPage from "./SettingsPage";
import {
  activeSettings, loadPreferences, modelLabel, persistPreferences, settingsError,
  type LLMPreferences,
} from "./llmSettings";
import "./App.css";

type BackendHealth = {
  status: string;
  service: string;
};

type ExtractedWebsite = {
  url: string;
  text: string;
};

type ArticleSummary = {
  summary: string;
  key_points: string[];
  model: string;
  mode: "local" | "cloud";
  provider: string;
  inputText: string;
};

function App() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractedWebsite | null>(null);
  const [text, setText] = useState("");
  const [fetchVersion, setFetchVersion] = useState(0);
  const [page, setPage] = useState<"article" | "settings">("article");
  const [preferences, setPreferences] = useState<LLMPreferences>(loadPreferences);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [articleSummary, setArticleSummary] = useState<ArticleSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkBackend = async () => {
      try {
        const result = await invoke<BackendHealth>("backend_health");
        if (!cancelled) {
          setHealth(result);
          setBackendError(null);
        }
      } catch (cause) {
        if (cancelled) return;
        attempts += 1;
        if (attempts < 60) {
          timer = setTimeout(checkBackend, 500);
        } else {
          setBackendError(String(cause));
        }
      }
    };

    void checkBackend();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const fetchWebsite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!health || isFetching || isSummarizing) return;

    const websiteUrl = url.trim();
    try {
      const parsedUrl = new URL(websiteUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Unsupported URL scheme");
      }
    } catch {
      setFetchError("Enter a valid http:// or https:// website link.");
      return;
    }

    setIsFetching(true);
    setFetchError(null);
    try {
      const result = await invoke<ExtractedWebsite>("backend_extract", {
        url: websiteUrl,
      });
      setExtraction(result);
      setText(result.text);
      setArticleSummary(null);
      setSummaryError(null);
      // Remount the disclosure so every newly fetched article starts collapsed.
      setFetchVersion((version) => version + 1);
    } catch (cause) {
      setFetchError(String(cause));
    } finally {
      setIsFetching(false);
    }
  };

  const saveSettings = (next: LLMPreferences) => {
    setPreferences(next);
    setSummaryError(null);
    try {
      persistPreferences(next);
      setSettingsMessage("Model settings saved. API keys are kept for this session only.");
    } catch {
      setSettingsMessage("Settings are active for this session. Device storage was unavailable.");
    }
    setPage("article");
  };

  const generateSummary = async () => {
    if (!health || isFetching || isSummarizing || !text.trim()) return;
    const validationError = settingsError(preferences);
    if (validationError) { setSummaryError(validationError); return; }
    setIsSummarizing(true);
    setSummaryError(null);
    const inputText = text;
    try {
      const result = await invoke<Omit<ArticleSummary, "inputText">>("backend_summarize", {
        text: inputText, settings: activeSettings(preferences),
      });
      setArticleSummary({ ...result, inputText });
    } catch (cause) {
      setSummaryError(String(cause));
    } finally {
      setIsSummarizing(false);
    }
  };

  const isBusy = isFetching || isSummarizing;
  const modelReady = settingsError(preferences) === null;
  const selectedModel = activeSettings(preferences);
  const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const isEdited = extraction !== null && text !== extraction.text;

  return (
    <main className="app-shell">
      <div className="app-heading">
        <div className="eyebrow">Local Summarizer</div>
        <span
          className={`status-pill ${health ? "ready" : backendError ? "error" : "starting"}`}
          role="status"
        >
          <span className="status-dot" aria-hidden="true" />
          {health ? "Local backend ready" : backendError ? "Backend unavailable" : "Starting backend…"}
        </span>
      </div>
      <nav className="page-nav" aria-label="Main pages">
        <button className={page === "article" ? "active" : ""} aria-current={page === "article" ? "page" : undefined} onClick={() => setPage("article")} disabled={isBusy}>Article</button>
        <button className={page === "settings" ? "active" : ""} aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")} disabled={isBusy}>Settings</button>
      </nav>
      {page === "settings" ? (
        <SettingsPage preferences={preferences} backendReady={health !== null} onSave={saveSettings} onCancel={() => setPage("article")} />
      ) : (
      <>
      <h1>Start with a link.</h1>
      <p className="intro">
        Fetch the text from a blog, news story, or article. Review and edit what
        comes back, then generate a summary and key points with your chosen model.
      </p>
      {settingsMessage && <p className="fetch-success" role="status">{settingsMessage}</p>}

      <section className="fetch-card" aria-labelledby="website-label">
        <form onSubmit={fetchWebsite} aria-busy={isFetching}>
          <label id="website-label" htmlFor="website-url">Website link</label>
          <div className="fetch-controls">
            <input
              id="website-url"
              name="url"
              type="url"
              placeholder="https://example.com/article"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              disabled={isBusy}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="fetch-hint"
            />
            <button type="submit" disabled={!health || isBusy || !url.trim()}>
              {isFetching ? "fetching…" : "fetch"}
            </button>
          </div>
          <p id="fetch-hint" className="field-hint">
            Use a direct article link, including https://. Fetching needs an internet connection.
          </p>
        </form>
        <div className="fetch-feedback" aria-live="polite" aria-atomic="true">
          {isFetching && <p className="fetch-progress">Fetching the page and extracting its text…</p>}
          {!isFetching && !fetchError && extraction && (
            <p className="fetch-success">Text extracted. Open the panel below to review and edit it.</p>
          )}
        </div>
        {fetchError && <p className="error-message" role="alert">{fetchError}</p>}
        {backendError && (
          <p className="error-message" role="alert">
            Could not start the local backend. Restart the desktop app to try again.
            <span className="error-detail">{backendError}</span>
          </p>
        )}
      </section>

      {extraction && (
        <details className="text-panel" key={fetchVersion}>
          <summary>
            <span className="disclosure-arrow" aria-hidden="true">›</span>
            <span className="panel-title">Extracted text</span>
            <span className="text-meta">
              {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
              {isEdited && <span className="edited-badge">Edited</span>}
            </span>
          </summary>
          <div className="editor-body">
            <p className="source-url">{extraction.url}</p>
            <label htmlFor="extracted-text">Review and edit the extracted text</label>
            <p id="editor-hint" className="field-hint">
              Correct missing or unwanted content here. Your edits stay in this session;
              fetching another page replaces this text.
            </p>
            <textarea
              id="extracted-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-describedby="editor-hint"
              spellCheck
              disabled={isBusy}
            />
          </div>
        </details>
      )}

      {extraction && (
        <section className="summary-card" aria-labelledby="summary-heading" aria-busy={isSummarizing}>
          <div className="summary-heading">
            <h2 id="summary-heading">Summary &amp; key points</h2>
            <button onClick={() => void generateSummary()} disabled={!health || isBusy || !text.trim() || !modelReady}>
              {isSummarizing ? "Summarizing…" : articleSummary ? "Regenerate summary" : "Summarize"}
            </button>
          </div>
          <p className="field-hint">{modelReady ? modelLabel(selectedModel) : settingsError(preferences)}
            {!modelReady && <> <button className="text-button" onClick={() => setPage("settings")} disabled={isBusy}>Open settings</button></>}
          </p>
          {modelReady && <p className="privacy-note">{preferences.mode === "cloud"
            ? "Summarizing sends your current edited text to the selected cloud provider. Provider usage charges may apply."
            : "Your current edited text will be summarized by your local model."}</p>}
          <div aria-live="polite" aria-atomic="true">
            {isSummarizing && <p className="fetch-progress">Generating a summary and key points. Local models may take a few minutes…</p>}
          </div>
          {summaryError && <p className="error-message" role="alert">{summaryError}</p>}
          {articleSummary && (
            <div className="summary-output">
              <p className="result-model">Generated with {articleSummary.mode === "local" ? "a local" : "a cloud"} model · {articleSummary.model}</p>
              {articleSummary.inputText !== text && <p className="stale-summary" role="status">The article text has changed. Regenerate the summary to include your edits.</p>}
              <h3>Summary</h3>
              <p className="summary-text">{articleSummary.summary}</p>
              <h3>Key points</h3>
              <ul className="key-points">{articleSummary.key_points.map((point, index) => <li key={index}>{point}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <p className="local-note">
        {preferences.mode === "local" ? "Extraction and summarization stay on your device." : "Extraction runs on your device. Summarization uses your selected cloud provider."}
      </p>
      </>
      )}
    </main>
  );
}

export default App;
