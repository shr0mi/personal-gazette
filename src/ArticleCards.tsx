import { ArrowUpRight, Star } from "lucide-react";
import type { SavedArticle } from "./savedArticles";

export function articleDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, "");
}

export function formattedDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

type Props = {
  articles: SavedArticle[];
  onOpen: (article: SavedArticle) => void;
  onFavorite: (article: SavedArticle) => void;
  disabled: boolean;
  favoriteDisabled?: boolean;
};

export default function ArticleCards({ articles, onOpen, onFavorite, disabled, favoriteDisabled }: Props) {
  return (
    <div className="article-grid">
      {articles.map((article, index) => (
        <article className="article-card" key={article.id}>
          <div className="card-meta"><span className="card-number">{String(index + 1).padStart(2, "0")}</span><span>{articleDomain(article.url)}</span></div>
          <button className="card-open" onClick={() => onOpen(article)} disabled={disabled} aria-label={`Open ${article.title}`}>
            <h3>{article.title}</h3>
            <p>{article.summary.summary}</p>
            <span className="card-read">Read the summary <ArrowUpRight size={18} strokeWidth={1.5} aria-hidden="true" /></span>
          </button>
          <div className="card-footer">
            <time dateTime={article.savedAt}>{formattedDate(article.savedAt)}</time>
            <button className={`icon-button favorite-toggle ${article.isFavorite ? "is-favorite" : ""}`} onClick={() => onFavorite(article)}
              disabled={disabled || favoriteDisabled} aria-pressed={article.isFavorite}
              aria-label={`${article.isFavorite ? "Unfavorite" : "Favorite"} ${article.title}`}>
              <Star size={18} strokeWidth={1.5} fill={article.isFavorite ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
