import type { ComponentProps, FormEvent } from "react";
import { ArrowUpRight, Bookmark, ChevronRight, Eye, FileText, LoaderCircle, PenLine, Sparkles, Star, Trash2 } from "lucide-react";
import FetchForm from "./FetchForm";
import ExternalLink from "./ExternalLink";
import KeyPointsEditor from "./KeyPointsEditor";
import { articleDomain, formattedDate } from "./ArticleCards";
import { modelLabel } from "./llmSettings";
import type { ArticleSummary, SavedArticle } from "./savedArticles";

type Props = {
  fetchProps: ComponentProps<typeof FetchForm>;
  extraction: { url: string; text: string } | null;
  text: string;
  onTextChange: (text: string) => void;
  fetchVersion: number;
  summary: (ArticleSummary & { inputText: string }) | null;
  onSummaryChange: (summary: string) => void;
  onKeyPointsChange: (keyPoints: string[]) => void;
  title: string;
  onTitleChange: (title: string) => void;
  savedArticle: SavedArticle | null;
  backendReady: boolean;
  modelError: string | null;
  modelName: string;
  mode: "local" | "cloud";
  generationStage: "fetching" | "summarizing" | null;
  summaryError: string | null;
  storageError: string | null;
  feedback: { error?: string; message?: string } | null;
  onSummarize: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onFavorite: () => void;
  onRemove: () => void;
  onSettings: () => void;
  onSaved: () => void;
  onView: () => void;
};

export default function ArticleEditPage({ fetchProps, extraction, text, onTextChange, fetchVersion, summary, onSummaryChange, onKeyPointsChange, title, onTitleChange,
  savedArticle, backendReady, modelError, modelName, mode, generationStage, summaryError, storageError, feedback,
  onSummarize, onSave, onFavorite, onRemove, onSettings, onSaved, onView }: Props) {
  const source = extraction?.url ?? savedArticle?.url;
  const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const stale = summary !== null && summary.mode !== "manual" && extraction !== null && summary.inputText !== text;
  const edited = extraction !== null && text !== extraction.text;
  const canSave = !!summary?.summary.trim() && !storageError && !fetchProps.disabled;
  return (
    <>
      <div className={`page-heading ${source ? "article-heading" : ""}`}>
        <div className="article-editor-toolbar"><p className="eyebrow accent">{savedArticle ? "Edit your saved article" : "The writing desk"}</p>{source && <button className="text-button" onClick={onView} disabled={fetchProps.disabled || !summary?.summary.trim()}><Eye size={16} />View article</button>}</div>
        <h1>{source ? title || "Untitled article" : <>Read between<br /><em>the lines.</em></>}</h1>
        {source ? <div className="article-byline"><ExternalLink href={source} aria-label={`Open original article on ${articleDomain(source)} in your browser`}>{articleDomain(source)} <ArrowUpRight size={14} /></ExternalLink><span>{savedArticle ? `Saved ${formattedDate(savedArticle.savedAt)}` : `${wordCount.toLocaleString()} words extracted`}</span>{savedArticle?.isFavorite && <span className="accent"><Star size={12} fill="currentColor" /> Favorite</span>}</div>
          : <p className="intro">One link. A clearer picture. Your next good read starts here.</p>}
      </div>
      <section className="article-fetch"><FetchForm {...fetchProps} /></section>

      {(extraction || savedArticle) && (
        <details className="text-panel" key={fetchVersion}>
          <summary><ChevronRight className="disclosure-arrow" size={18} strokeWidth={1.5} aria-hidden="true" /><FileText size={18} strokeWidth={1.5} aria-hidden="true" /><span className="panel-title">Extracted text</span><span className="text-meta">{extraction ? `${wordCount.toLocaleString()} words` : "Fetch to review"}{edited && <span className="edited-badge">Edited</span>}</span></summary>
          <div className="editor-body">
            {extraction ? <><p className="source-url">{extraction.url}</p><label htmlFor="extracted-text">Review &amp; edit the source</label><p id="editor-hint" className="field-hint">Remove the noise or correct the text. AI generation uses exactly what’s here.</p>
              <textarea id="extracted-text" value={text} onChange={(event) => onTextChange(event.target.value)} aria-describedby="editor-hint" spellCheck disabled={fetchProps.disabled} /></>
              : <p className="field-hint">Original text is kept only during your reading session. Fetch article retrieves it again. You can edit your saved summary and key points here anytime.</p>}
          </div>
        </details>
      )}

      {summary ? (
        <section className="article-results" aria-labelledby="results-heading" aria-busy={generationStage !== null}>
          <div className="results-toolbar">
            <div><p className="eyebrow">The essential edition</p><h2 id="results-heading">At a glance.</h2></div>
            <div className="result-actions">
              <button onClick={onSummarize} aria-describedby="ai-generate-hint" disabled={!backendReady || fetchProps.disabled || (extraction !== null && !text.trim()) || !!modelError}>{generationStage ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{generationStage === "fetching" ? "Fetching…" : generationStage === "summarizing" ? "Generating…" : "AI generate"}</button>
            </div>
          </div>
          {summary.mode === "manual" && <aside className="retention-note"><PenLine size={20} strokeWidth={1.5} aria-hidden="true" /><div><h3>Make it stick. Write it yourself.</h3><p>Try writing the summary and key points in your own words, from memory. Recalling what you read can help you remember it longer.</p></div></aside>}
          <p id="ai-generate-hint" className="field-hint">AI generate replaces your summary and key points. You can edit the result before saving.{!extraction && " It fetches the article text first."}</p>
          <p className="field-hint model-hint">{modelError ? "Write and save your own notes, or choose a model for AI generation." : `AI model: ${modelName}`}{modelError && <> <button className="text-button" onClick={onSettings} disabled={fetchProps.disabled}>Choose a model <ArrowUpRight size={14} /></button></>}</p>
          <p className="privacy-note">{mode === "cloud" ? "AI generation sends the article text to your cloud provider. Provider charges may apply." : "AI generation uses your local model, on your own device."}</p>
          {generationStage && <p className="fetch-progress" role="status">{generationStage === "fetching" ? "Fetching fresh article text…" : "Generating your heading, summary and key points. This may take a few minutes…"}</p>}
          {summaryError && <p className="error-message" role="alert">{summaryError}</p>}
          {stale && <p className="stale-summary" role="status">The source text has changed since AI generation. Edit your summary and key points to match, or use AI generate again.</p>}
          <div className="summary-columns">
              <div className="summary-column"><p className="eyebrow">01 / The summary</p><h3>The story, distilled.</h3><label className="visually-hidden" htmlFor="article-summary">Summary</label><textarea id="article-summary" className="summary-editor" value={summary.summary} onChange={(event) => onSummaryChange(event.target.value)} placeholder="What was the article about? Tell the story in your own words…" aria-describedby="summary-hint" spellCheck disabled={fetchProps.disabled} /><p id="summary-hint" className="field-hint">Write a summary to save this article. You can keep editing it anytime.</p><p className="result-model">{summary.mode === "manual" ? "Your own words" : `AI draft · ${summary.mode === "local" ? "Local" : "Cloud"} model · ${modelLabel(summary)}`}</p></div>
              <div className="keypoints-column"><p className="eyebrow">02 / Key points</p><h3>What to take away.</h3><KeyPointsEditor key={source} points={summary.key_points} onChange={onKeyPointsChange} disabled={fetchProps.disabled} /></div>
          </div>
          <form className="save-article-form" onSubmit={onSave}>
              <div className="save-title"><label htmlFor="article-title">A title for your collection</label><input id="article-title" aria-label="Saved article title" aria-describedby="article-title-hint" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Article title" maxLength={200} required disabled={fetchProps.disabled} /><p id="article-title-hint" className="field-hint">Give this article a heading that makes sense to you.</p></div>
              <div className="save-actions"><button type="submit" disabled={!canSave || !title.trim()}><Bookmark size={16} fill={savedArticle ? "currentColor" : "none"} />{savedArticle ? "Update saved article" : "Save article"}</button>
                <button type="button" className={`secondary-button ${savedArticle?.isFavorite ? "is-favorite" : ""}`} onClick={onFavorite} disabled={!canSave || !title.trim()} aria-pressed={savedArticle?.isFavorite ?? false}><Star size={16} fill={savedArticle?.isFavorite ? "currentColor" : "none"} />{savedArticle?.isFavorite ? "Favorited" : "Favorite"}</button>
                {savedArticle && <button type="button" className="icon-button remove-article" aria-label="Remove article from saved articles" onClick={onRemove} disabled={fetchProps.disabled || !!storageError}><Trash2 size={17} /></button>}</div>
              <p className="field-hint save-hint">{savedArticle ? "Your article is kept on this device. Star it to feature it on Home." : "Save for later, or favorite to save and feature it on Home."}</p>
          </form>
          {storageError && <p className="error-message" role="alert">{storageError}</p>}
          {feedback?.error && <p className="error-message" role="alert">{feedback.error}</p>}
          {feedback?.message && <p className="fetch-success" role="status">{feedback.message} <button type="button" className="text-button" onClick={onSaved} disabled={fetchProps.disabled}>View saved <ArrowUpRight size={14} /></button></p>}
        </section>
      ) : !fetchProps.isFetching && <section className="article-start"><div className="empty-symbol"><FileText size={32} strokeWidth={1} /></div><p className="eyebrow">A clean page. A fresh perspective.</p><h2>What are you reading today?</h2><p>Paste a link above to extract the article.<br />Write your summary and key points, or use AI to get started.</p></section>}
    </>
  );
}
