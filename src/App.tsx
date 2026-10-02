import { useEffect, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { BookOpen, Menu, X } from "lucide-react";
import HomePage from "./HomePage";
import ExternalLink from "./ExternalLink";
import ArticlePage from "./ArticlePage";
import SettingsPage from "./SettingsPage";
import SavedArticlesPage from "./SavedArticlesPage";
import { activeSettings, loadPreferences, modelLabel, persistPreferences, settingsError, type LLMPreferences } from "./llmSettings";
import { articleUrl, loadSavedArticles, persistSavedArticles, refreshSavedArticle, saveArticle, sortedArticles, titleFromUrl, toggleArticleFavorite, type SavedArticle, type SummaryResult } from "./savedArticles";
import "./App.css";

type Page = "home" | "article" | "saved" | "settings";
type BackendHealth = { status: string; service: string };
type ExtractedWebsite = { url: string; text: string };
type ArticleSummary = SummaryResult & { inputText: string };
type Feedback = { error?: string; message?: string } | null;
const pages: { id: Page; label: string }[] = [{ id: "home", label: "Home" }, { id: "saved", label: "Saved articles" }, { id: "article", label: "Article" }, { id: "settings", label: "Settings" }];

function currentPage(): Page {
  const hash = window.location.hash.replace(/^#\/?/u, "");
  return pages.some(({ id }) => id === hash) ? hash as Page : "home";
}

function App() {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractedWebsite | null>(null);
  const [text, setText] = useState("");
  const [fetchVersion, setFetchVersion] = useState(0);
  const [page, setPage] = useState<Page>(currentPage);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsReturnPage, setSettingsReturnPage] = useState<Exclude<Page, "settings">>("home");
  const [preferences, setPreferences] = useState<LLMPreferences>(loadPreferences);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [articleSummary, setArticleSummary] = useState<ArticleSummary | null>(null);
  const [articleTitle, setArticleTitle] = useState("");
  const [openedArticleId, setOpenedArticleId] = useState<string | null>(null);
  const [savedState, setSavedState] = useState<{ articles: SavedArticle[]; error: string | null }>(() => {
    try { return { articles: loadSavedArticles(), error: null }; }
    catch { return { articles: [], error: "Could not read saved articles from device storage. Reload the app to try again. Existing saved data has been left untouched." }; }
  });
  const [saveFeedback, setSaveFeedback] = useState<Feedback>(null);
  const [libraryFeedback, setLibraryFeedback] = useState<Feedback>(null);
  const [refreshProgress, setRefreshProgress] = useState<{ id: string; stage: "fetching" | "summarizing" } | null>(null);
  const isBusy = isFetching || isSummarizing || refreshProgress !== null;
  const selectedModel = activeSettings(preferences);
  const currentSavedArticle = savedState.articles.find((article) => extraction ? article.url === articleUrl(extraction.url) : article.id === openedArticleId) ?? null;
  const favorites = sortedArticles(savedState.articles).filter((article) => article.isFavorite);

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === "#main-content") return;
      setPage(currentPage()); setMobileMenuOpen(false);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkBackend = async () => {
      try {
        const result = await invoke<BackendHealth>("backend_health");
        if (!cancelled) { setHealth(result); setBackendError(null); }
      } catch (cause) {
        if (cancelled) return;
        attempts += 1;
        if (attempts < 60) timer = setTimeout(checkBackend, 500);
        else setBackendError(String(cause));
      }
    };
    void checkBackend();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const navigate = (next: Page) => {
    if (next === "settings" && page !== "settings") setSettingsReturnPage(page);
    setPage(next);
    setMobileMenuOpen(false);
    window.location.hash = `/${next}`;
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openSettings = () => navigate("settings");

  const fetchWebsite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!health || isBusy) return;
    const websiteUrl = url.trim();
    try { articleUrl(websiteUrl); }
    catch { setFetchError("Enter a valid http:// or https:// website link."); return; }
    navigate("article");
    setIsFetching(true);
    setFetchError(null);
    setSaveFeedback(null);
    try {
      const result = await invoke<ExtractedWebsite>("backend_extract", { url: websiteUrl });
      setExtraction(result);
      setText(result.text);
      setOpenedArticleId(null);
      setArticleSummary(null);
      setArticleTitle(savedState.articles.find((article) => article.url === articleUrl(result.url))?.title ?? titleFromUrl(result.url));
      setSummaryError(null);
      setFetchVersion((version) => version + 1);
    } catch (cause) { setFetchError(String(cause)); }
    finally { setIsFetching(false); }
  };

  const saveSettings = (next: LLMPreferences) => {
    setPreferences(next);
    setSummaryError(null);
    try { persistPreferences(next); setSettingsMessage("Model settings saved. API keys stay in this session."); }
    catch { setSettingsMessage("Settings are active for this session. Device storage was unavailable."); }
    navigate(settingsReturnPage);
  };

  const generateSummary = async () => {
    if (!health || isBusy || !text.trim()) return;
    const validationError = settingsError(preferences);
    if (validationError) { setSummaryError(validationError); return; }
    setIsSummarizing(true);
    setSummaryError(null);
    setSaveFeedback(null);
    const inputText = text;
    try {
      const result = await invoke<SummaryResult>("backend_summarize", { text: inputText, settings: activeSettings(preferences) });
      setArticleSummary({ ...result, inputText });
    } catch (cause) { setSummaryError(String(cause)); }
    finally { setIsSummarizing(false); }
  };

  const writeArticles = (next: SavedArticle[], error: string): boolean => {
    try { persistSavedArticles(next); setSavedState({ articles: next, error: null }); return true; }
    catch { setSaveFeedback({ error }); setLibraryFeedback({ error }); return false; }
  };

  const saveCurrentArticle = (event?: FormEvent<HTMLFormElement>, favorite = false) => {
    event?.preventDefault();
    const source = extraction?.url ?? currentSavedArticle?.url;
    if (!source || !articleSummary || articleSummary.inputText !== text || isBusy || savedState.error || !articleTitle.trim()) return;
    let next = saveArticle(savedState.articles, source, articleTitle, articleSummary);
    if (favorite) next = next.map((article, index) => index === 0 ? { ...article, isFavorite: true } : article);
    if (writeArticles(next, "Could not save the article. Device storage may be full or unavailable. Your summary is still here; try again.")) {
      setSaveFeedback({ message: favorite ? "Saved and added to your favorites." : "Article and summary saved on this device." });
      setLibraryFeedback(null);
    }
  };

  const toggleFavorite = (article: SavedArticle) => {
    if (isBusy || savedState.error) return;
    if (writeArticles(toggleArticleFavorite(savedState.articles, article.id), "Could not update favorites in device storage. Try again.")) {
      setSaveFeedback({ message: article.isFavorite ? "Removed from favorites. Your article is still saved." : "Added to favorites. Find it on Home." });
      setLibraryFeedback(null);
    }
  };

  const favoriteCurrentArticle = () => {
    if (currentSavedArticle) toggleFavorite(currentSavedArticle);
    else saveCurrentArticle(undefined, true);
  };

  const openArticle = (article: SavedArticle) => {
    if (isBusy) return;
    setOpenedArticleId(article.id);
    setUrl(article.url);
    setArticleTitle(article.title);
    setArticleSummary({ ...article.summary, inputText: "" });
    setExtraction(null);
    setText("");
    setFetchError(null);
    setSummaryError(null);
    setSaveFeedback(null);
    setFetchVersion((version) => version + 1);
    navigate("article");
  };

  const refreshArticle = async () => {
    const article = currentSavedArticle;
    if (!article || !health || isBusy || savedState.error) return;
    const validationError = settingsError(preferences);
    if (validationError) { setSummaryError(validationError); return; }
    const settings = activeSettings(preferences);
    setRefreshProgress({ id: article.id, stage: "fetching" });
    setSaveFeedback(null);
    setSummaryError(null);
    try {
      const refreshed = await refreshSavedArticle(article, {
        extract: (articleLink) => invoke<ExtractedWebsite>("backend_extract", { url: articleLink }),
        summarize: (freshText) => {
          setRefreshProgress({ id: article.id, stage: "summarizing" });
          return invoke<SummaryResult>("backend_summarize", { text: freshText, settings });
        },
      });
      const next = [refreshed, ...savedState.articles.filter((entry) => entry.id !== article.id)];
      if (writeArticles(next, "Could not store the new summary. Your previous saved summary has been kept.")) {
        setArticleSummary({ ...refreshed.summary, inputText: "" });
        setSaveFeedback({ message: "Fresh summary saved." });
      }
    } catch (cause) {
      setSummaryError(`${cause instanceof Error ? cause.message : String(cause)} Your previous saved summary has been kept.`);
    } finally { setRefreshProgress(null); }
  };

  const removeCurrentArticle = () => {
    if (!currentSavedArticle || isBusy || savedState.error) return;
    const next = savedState.articles.filter((entry) => entry.id !== currentSavedArticle.id);
    if (writeArticles(next, "Could not remove the article from device storage. Try again.")) {
      setOpenedArticleId(null);
      setArticleSummary(null);
      setArticleTitle("");
      setExtraction(null);
      setText("");
      setUrl("");
      setLibraryFeedback({ message: "Article removed from your archive." });
      navigate("saved");
    }
  };

  const fetchProps = { url, onUrlChange: setUrl, onFetch: fetchWebsite, isFetching, disabled: isBusy, backendReady: health !== null, error: fetchError, id: page };
  const editionDate = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka" });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="edition-bar"><span>Vol. 01 / The personal edition</span><time>{editionDate}</time><span>Less noise. More perspective.</span></div>
        <div className="masthead">
          <div className="masthead-note"><BookOpen size={25} strokeWidth={1} /><span>A little less reading.<br />A little more knowing.</span></div>
          <button className="wordmark" onClick={() => navigate("home")} disabled={isBusy} aria-label="Local Summarizer home">The Local Summarizer<span className="heading-period">.</span></button>
          <div className={`backend-status ${backendError ? "error" : ""}`} role="status"><span className="status-dot" aria-hidden="true" />{health ? "Backend ready" : backendError ? "Backend unavailable" : isTauri() ? "Starting backend…" : "Desktop preview"}<small>Your reading. Your device.</small></div>
        </div>
        <div className="navigation-bar">
          <button className="mobile-menu-button icon-button" aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen} aria-controls="main-navigation" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>{mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>
          <nav className={`page-nav ${mobileMenuOpen ? "is-open" : ""}`} id="main-navigation" aria-label="Main pages">{pages.map(({ id, label }) => <button key={id} className={page === id ? "active" : ""} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)} disabled={isBusy}>{label}{id === "saved" && savedState.articles.length > 0 && <span className="nav-count">{savedState.articles.length}</span>}</button>)}</nav>
        </div>
      </header>
      <main id="main-content" className="page-content" tabIndex={-1}>
        {backendError && <p className="error-message" role="alert">Could not start the local backend. Restart the desktop app to try again.<span className="error-detail">{backendError}</span></p>}
        {settingsMessage && <div className="settings-notice" role="status"><span>{settingsMessage}</span><button className="icon-button" aria-label="Dismiss settings message" onClick={() => setSettingsMessage(null)}><X size={16} /></button></div>}
        {page === "home" && libraryFeedback?.error && <p className="error-message" role="alert">{libraryFeedback.error}</p>}
        {page === "home" ? <HomePage fetchProps={fetchProps} favorites={favorites} storageError={savedState.error} onOpen={openArticle} onFavorite={toggleFavorite} onSaved={() => navigate("saved")} />
          : page === "saved" ? <SavedArticlesPage articles={savedState.articles} storageError={savedState.error} disabled={isBusy} feedback={libraryFeedback} onOpen={openArticle} onFavorite={toggleFavorite} onArticle={() => navigate("article")} />
          : page === "settings" ? <SettingsPage preferences={preferences} backendReady={health !== null} onSave={saveSettings} onCancel={() => navigate(settingsReturnPage)} />
          : <ArticlePage fetchProps={fetchProps} extraction={extraction} text={text} onTextChange={(next) => { setText(next); setSaveFeedback(null); }} fetchVersion={fetchVersion} summary={articleSummary} title={articleTitle} onTitleChange={(next) => { setArticleTitle(next); setSaveFeedback(null); }} savedArticle={currentSavedArticle} backendReady={health !== null} modelError={settingsError(preferences)} modelName={modelLabel(selectedModel)} mode={preferences.mode} isSummarizing={isSummarizing} refreshStage={refreshProgress?.stage ?? null} summaryError={summaryError} storageError={savedState.error} feedback={saveFeedback} onSummarize={() => void generateSummary()} onSave={saveCurrentArticle} onFavorite={favoriteCurrentArticle} onRefresh={() => void refreshArticle()} onRemove={removeCurrentArticle} onSettings={openSettings} onSaved={() => navigate("saved")} />}
      </main>
      <footer className="site-footer">
        <span className="footer-brand">The Local Summarizer.</span>
        <div className="footer-details">
          <span className="footer-open-source">Free and Open Source App</span>
          <span className="footer-credit">By shr0mi</span>
          <ExternalLink className="footer-github" href="https://github.com/shr0mi/local-summarizer" aria-label="Open local-summarizer on GitHub in your browser">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.494.998.108-.776.418-1.305.762-1.605-2.665-.304-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 5.801c1.02.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.119 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 21.796 24 17.3 24 12c0-6.627-5.373-12-12-12Z" />
            </svg>
            GitHub
          </ExternalLink>
        </div>
      </footer>
    </div>
  );
}

export default App;
