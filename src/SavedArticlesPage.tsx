import { useState } from "react";
import { ArrowUpRight, Bookmark, Search, Star } from "lucide-react";
import ArticleCards from "./ArticleCards";
import { sortedArticles, type SavedArticle } from "./savedArticles";

type Props = {
  articles: SavedArticle[];
  storageError: string | null;
  disabled: boolean;
  feedback: { error?: string; message?: string } | null;
  onOpen: (article: SavedArticle) => void;
  onFavorite: (article: SavedArticle) => void;
  onArticle: () => void;
};

export default function SavedArticlesPage({ articles, storageError, disabled, feedback, onOpen, onFavorite, onArticle }: Props) {
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = articles.filter((article) => article.isFavorite);
  const visible = sortedArticles(articles).filter((article) => (!favoritesOnly || article.isFavorite) &&
    `${article.title} ${article.url} ${article.summary.summary}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <>
      <div className="page-heading saved-heading">
        <div><p className="eyebrow accent">The personal archive</p><h1>Good reads.<br /><em>Kept close.</em></h1>
          <p className="intro">Your collection of ideas worth holding on to. Favorites always come first.</p></div>
        <div className="archive-stats"><div><strong>{String(articles.length).padStart(2, "0")}</strong><span>Saved articles</span></div><div><strong>{String(favorites.length).padStart(2, "0")}</strong><span>Favorites</span></div></div>
      </div>
      <div className="library-toolbar">
        <div className="library-filters" role="group" aria-label="Filter articles">
          <button className={`filter-button ${!favoritesOnly ? "active" : ""}`} aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>All articles <span>{articles.length}</span></button>
          <button className={`filter-button ${favoritesOnly ? "active" : ""}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}><Star size={15} /> Favorites <span>{favorites.length}</span></button>
        </div>
        <div className="library-search"><Search size={17} strokeWidth={1.5} aria-hidden="true" /><input aria-label="Search saved articles" type="search" placeholder="Search your collection…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      </div>
      {storageError && <p className="error-message" role="alert">{storageError}</p>}
      {feedback?.error && <p className="error-message" role="alert">{feedback.error}</p>}
      {feedback?.message && <p className="fetch-success" role="status">{feedback.message}</p>}
      <h2 className="visually-hidden">Your saved articles</h2>
      {visible.length > 0 ? <ArticleCards articles={visible} onOpen={onOpen} onFavorite={onFavorite} disabled={disabled} favoriteDisabled={!!storageError} /> : !storageError && (
        <section className="saved-empty">
          {articles.length === 0 ? <><Bookmark size={36} strokeWidth={1} /><p className="eyebrow">A fresh start</p><h2>Your archive is waiting.</h2><p>Fetch an article, make sense of it, and save the summary here.</p><button onClick={onArticle} disabled={disabled}>Find your first read <ArrowUpRight size={18} /></button></>
            : <><Search size={32} strokeWidth={1} /><h2>{query ? "No matching reads." : "No favorites just yet."}</h2><p>{query ? "Try a different title, source, or phrase." : "Star an article to add it to your favorites."}</p><button className="secondary-button" onClick={() => { setQuery(""); setFavoritesOnly(false); }}>Show all articles</button></>}
        </section>
      )}
      <p className="local-note"><Bookmark size={14} strokeWidth={1.5} /> Stored on this device. Your summaries are available even when you’re offline.</p>
    </>
  );
}
