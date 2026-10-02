import type { ComponentProps, FormEvent } from "react";
import { ArrowDown, ArrowUpRight, Bookmark, ChevronRight, FileText, LoaderCircle, RefreshCw, Star, Trash2 } from "lucide-react";
import FetchForm from "./FetchForm";
import ExternalLink from "./ExternalLink";
import { articleDomain, formattedDate } from "./ArticleCards";
import { modelLabel } from "./llmSettings";
import type { SavedArticle, SummaryResult } from "./savedArticles";

type Props = {
  fetchProps: ComponentProps<typeof FetchForm>;
  extraction: { url: string; text: string } | null;
  text: string;
  onTextChange: (text: string) => void;
  fetchVersion: number;
  summary: (SummaryResult & { inputText: string }) | null;
  title: string;
  onTitleChange: (title: string) => void;
  savedArticle: SavedArticle | null;
  backendReady: boolean;
  modelError: string | null;
  modelName: string;
  mode: "local" | "cloud";
  isSummarizing: boolean;
  refreshStage: "fetching" | "summarizing" | null;
  summaryError: string | null;
  storageError: string | null;
  feedback: { error?: string; message?: string } | null;
  onSummarize: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onFavorite: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onSettings: () => void;
  onSaved: () => void;
};

export default function ArticlePage({ fetchProps, extraction, text, onTextChange, fetchVersion, summary, title, onTitleChange,
  savedArticle, backendReady, modelError, modelName, mode, isSummarizing, refreshStage, summaryError, storageError, feedback,
  onSummarize, onSave, onFavorite, onRefresh, onRemove, onSettings, onSaved }: Props) {
  const source = extraction?.url ?? savedArticle?.url;
  const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const stale = summary !== null && summary.inputText !== text;
  const edited = extraction !== null && text !== extraction.text;
  const canSave = summary !== null && !stale && !storageError && !fetchProps.disabled;
  return (
    <>
      <div className={`page-heading ${source ? "article-heading" : ""}`}>
        <p className="eyebrow accent">{savedArticle ? "From your personal archive" : "The article desk"}</p>
        <h1>{source ? title || "Untitled article" : <>Read between<br /><em>the lines.</em></>}</h1>
        {source ? <div className="article-byline"><ExternalLink href={source} aria-label={`Open original article on ${articleDomain(source)} in your browser`}>{articleDomain(source)} <ArrowUpRight size={14} /></ExternalLink><span>{savedArticle ? `Saved ${formattedDate(savedArticle.savedAt)}` : `${wordCount.toLocaleString()} words extracted`}</span>{savedArticle?.isFavorite && <span className="accent"><Star size={12} fill="currentColor" /> Favorite</span>}</div>
          : <p className="intro">One link. A clearer picture. Your next good read starts here.</p>}
      </div>
      <section className="article-fetch"><FetchForm {...fetchProps} /></section>

      {(extraction || savedArticle) && (
        <details className="text-panel" key={fetchVersion}>
          <summary><ChevronRight className="disclosure-arrow" size={18} strokeWidth={1.5} aria-hidden="true" /><FileText size={18} strokeWidth={1.5} aria-hidden="true" /><span className="panel-title">Extracted text</span><span className="text-meta">{extraction ? `${wordCount.toLocaleString()} words` : "Fetch to review"}{edited && <span className="edited-badge">Edited</span>}</span></summary>
          <div className="editor-body">
            {extraction ? <><p className="source-url">{extraction.url}</p><label htmlFor="extracted-text">Review &amp; edit the source</label><p id="editor-hint" className="field-hint">Remove the noise or correct the text. Your summary will use exactly what’s here.</p>
              <textarea id="extracted-text" value={text} onChange={(event) => onTextChange(event.target.value)} aria-describedby="editor-hint" spellCheck disabled={fetchProps.disabled} /></>
              : <p className="field-hint">Original text is kept only during your reading session. Use Fetch article above to retrieve it again; your saved summary stays in your archive.</p>}
          </div>
        </details>
      )}

      {extraction || summary ? (
        <section className="article-results" aria-labelledby="results-heading" aria-busy={isSummarizing || refreshStage !== null}>
          <div className="results-toolbar">
            <div><p className="eyebrow">The essential edition</p><h2 id="results-heading">At a glance.</h2></div>
            <div className="result-actions">
              {savedArticle && !extraction ? <button onClick={onRefresh} disabled={!backendReady || !!modelError || fetchProps.disabled || !!storageError}><RefreshCw size={15} />{refreshStage ? refreshStage === "fetching" ? "Fetching…" : "Summarizing…" : "Fetch & summarize again"}</button>
                : <button onClick={onSummarize} disabled={!backendReady || fetchProps.disabled || !text.trim() || !!modelError}>{isSummarizing ? <LoaderCircle className="spin" size={16} /> : <ArrowDown size={16} />}{isSummarizing ? "Summarizing…" : summary ? "Regenerate summary" : "Summarize article"}</button>}
            </div>
          </div>
          <p className="field-hint model-hint">{modelError ?? `Using ${modelName}`}{modelError && <> <button className="text-button" onClick={onSettings} disabled={fetchProps.disabled}>Choose a model <ArrowUpRight size={14} /></button></>}</p>
          <p className="privacy-note">{mode === "cloud" ? "Summarizing sends the article text to your cloud provider. Provider charges may apply." : "Summarized by your local model, on your own device."}</p>
          {(isSummarizing || refreshStage) && <p className="fetch-progress" role="status">{refreshStage === "fetching" ? "Fetching fresh article text…" : "Generating your summary and key points. This may take a few minutes…"}</p>}
          {summaryError && <p className="error-message" role="alert">{summaryError}</p>}
          {stale && <p className="stale-summary" role="status">You’ve edited the source text. Regenerate the summary before saving to include your changes.</p>}
          {summary ? <>
            <div className="summary-columns">
              <div className="summary-column"><p className="eyebrow">01 / The summary</p><h3>The story, distilled.</h3><p className="summary-text drop-cap">{summary.summary}</p><p className="result-model">{summary.mode === "local" ? "Local" : "Cloud"} model · {modelLabel(summary)}</p></div>
              <div className="keypoints-column"><p className="eyebrow">02 / Key points</p><h3>What to take away.</h3><ol className="key-points">{summary.key_points.map((point, index) => <li key={index}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><p>{point}</p></li>)}</ol></div>
            </div>
            <form className="save-article-form" onSubmit={onSave}>
              <div className="save-title"><label htmlFor="article-title">A title for your collection</label><input id="article-title" aria-label="Saved article title" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Article title" maxLength={200} required disabled={fetchProps.disabled} /></div>
              <div className="save-actions"><button type="submit" disabled={!canSave || !title.trim()}><Bookmark size={16} fill={savedArticle ? "currentColor" : "none"} />{savedArticle ? "Update saved article" : "Save article"}</button>
                <button type="button" className={`secondary-button ${savedArticle?.isFavorite ? "is-favorite" : ""}`} onClick={onFavorite} disabled={!canSave || !title.trim()} aria-pressed={savedArticle?.isFavorite ?? false}><Star size={16} fill={savedArticle?.isFavorite ? "currentColor" : "none"} />{savedArticle?.isFavorite ? "Favorited" : "Favorite"}</button>
                {savedArticle && <button type="button" className="icon-button remove-article" aria-label="Remove article from saved articles" onClick={onRemove} disabled={fetchProps.disabled || !!storageError}><Trash2 size={17} /></button>}</div>
              <p className="field-hint save-hint">{savedArticle ? "Your article is kept on this device. Star it to feature it on Home." : "Save for later, or favorite to save and feature it on Home."}</p>
            </form>
          </> : <div className="summary-placeholder"><span aria-hidden="true">✳</span><h3>A long read. A short version.</h3><p>Review the extracted text, then summarize when you’re ready.</p></div>}
          {storageError && <p className="error-message" role="alert">{storageError}</p>}
          {feedback?.error && <p className="error-message" role="alert">{feedback.error}</p>}
          {feedback?.message && <p className="fetch-success" role="status">{feedback.message} <button type="button" className="text-button" onClick={onSaved} disabled={fetchProps.disabled}>View saved <ArrowUpRight size={14} /></button></p>}
        </section>
      ) : <section className="article-start"><div className="empty-symbol"><FileText size={32} strokeWidth={1} /></div><p className="eyebrow">A clean page. A fresh perspective.</p><h2>What are you reading today?</h2><p>Paste a link above to extract the article.<br />Review the text, get the key ideas, and make it yours.</p></section>}
    </>
  );
}
