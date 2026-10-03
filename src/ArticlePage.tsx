import { ArrowUpRight, BookOpen, PenLine, Star } from "lucide-react";
import ExternalLink from "./ExternalLink";
import { articleDomain, formattedDate } from "./ArticleCards";
import type { ArticleSummary, SavedArticle } from "./savedArticles";

type Props = {
  source: string | null;
  title: string;
  summary: ArticleSummary | null;
  savedArticle: SavedArticle | null;
  disabled: boolean;
  onEdit: () => void;
  onSaved: () => void;
};

export default function ArticlePage({ source, title, summary, savedArticle, disabled, onEdit, onSaved }: Props) {
  const keyPoints = summary?.key_points.map((point) => point.trim()).filter(Boolean) ?? [];

  return (
    <>
      <div className={`page-heading ${source ? "article-heading" : ""}`}>
        <p className="eyebrow accent">{savedArticle ? "From your personal archive" : "The article desk"}</p>
        <h1>{source ? title || "Untitled article" : <>Read between<br /><em>the lines.</em></>}</h1>
        {source && (
          <div className="article-byline">
            <ExternalLink href={source} aria-label={`Open original article on ${articleDomain(source)} in your browser`}>{articleDomain(source)} <ArrowUpRight size={14} /></ExternalLink>
            {savedArticle && <span>Saved {formattedDate(savedArticle.savedAt)}</span>}
            {savedArticle?.isFavorite && <span className="accent"><Star size={12} fill="currentColor" /> Favorite</span>}
          </div>
        )}
      </div>

      {source && summary?.summary.trim() ? (
        <section className="article-results" aria-labelledby="results-heading">
          <div className="results-toolbar">
            <div><p className="eyebrow">The essential edition</p><h2 id="results-heading">At a glance.</h2></div>
            <button onClick={onEdit} disabled={disabled}><PenLine size={16} />Edit article</button>
          </div>
          <div className="summary-columns">
            <div className="summary-column">
              <p className="eyebrow">01 / The summary</p>
              <h3>The story, distilled.</h3>
              <p className="summary-text drop-cap">{summary.summary.trim()}</p>
            </div>
            <div className="keypoints-column">
              <p className="eyebrow">02 / Key points</p>
              <h3>What to take away.</h3>
              {keyPoints.length > 0 ? <ol className="key-points">{keyPoints.map((point, index) => <li key={index}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><p>{point}</p></li>)}</ol> : <p className="field-hint">No key points saved yet.</p>}
            </div>
          </div>
        </section>
      ) : (
        <section className="article-start">
          <div className="empty-symbol"><BookOpen size={32} strokeWidth={1} /></div>
          <p className="eyebrow">A fresh perspective.</p>
          <h2>{source ? "Your summary is waiting." : "Choose something to read."}</h2>
          <p>{source ? "Write your summary and key points in Edit, then read them here." : "Open a saved article, or start with a link and write your own summary."}</p>
          <div className="article-start-actions">
            <button onClick={onEdit} disabled={disabled}><PenLine size={16} />{source ? "Edit article" : "New article"}</button>
            <button className="secondary-button" onClick={onSaved} disabled={disabled}>Saved articles <ArrowUpRight size={16} /></button>
          </div>
        </section>
      )}
    </>
  );
}
