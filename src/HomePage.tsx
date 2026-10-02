import { ArrowRight, Star } from "lucide-react";
import ArticleCards from "./ArticleCards";
import FetchForm from "./FetchForm";
import type { ComponentProps } from "react";
import type { SavedArticle } from "./savedArticles";

type Props = {
  fetchProps: ComponentProps<typeof FetchForm>;
  favorites: SavedArticle[];
  storageError: string | null;
  onOpen: (article: SavedArticle) => void;
  onFavorite: (article: SavedArticle) => void;
  onSaved: () => void;
};

export default function HomePage({ fetchProps, favorites, storageError, onOpen, onFavorite, onSaved }: Props) {
  return (
    <>
      <section className="home-start" aria-labelledby="home-title">
        <h1 id="home-title">Start with a link.</h1>
        <p className="intro">Paste an article link, review the extracted text, and generate a summary.</p>
        <FetchForm {...fetchProps} />
      </section>
      <section className="favorites-section" aria-labelledby="favorites-title">
        <div className="section-heading">
          <h2 id="favorites-title">Your favorites<span className="heading-period">.</span></h2>
          <button className="text-button section-link" onClick={onSaved} disabled={fetchProps.disabled}>View all saved <ArrowRight size={17} /></button>
        </div>
        {storageError && <p className="error-message" role="alert">{storageError}</p>}
        {favorites.length > 0 ? <ArticleCards articles={favorites} onOpen={onOpen} onFavorite={onFavorite} disabled={fetchProps.disabled} favoriteDisabled={!!storageError} /> : !storageError && (
          <div className="favorites-empty">
            <div className="empty-symbol"><Star size={29} strokeWidth={1} /></div>
            <div><h3>No favorites yet.</h3><p>Star a saved article to keep it here.</p></div>
          </div>
        )}
      </section>
    </>
  );
}
