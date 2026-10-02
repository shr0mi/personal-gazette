import type { FormEvent } from "react";
import { ArrowUpRight, Link2, LoaderCircle } from "lucide-react";

type Props = {
  url: string;
  onUrlChange: (url: string) => void;
  onFetch: (event: FormEvent<HTMLFormElement>) => void;
  isFetching: boolean;
  disabled: boolean;
  backendReady: boolean;
  error: string | null;
  id: string;
};

export default function FetchForm({ url, onUrlChange, onFetch, isFetching, disabled, backendReady, error, id }: Props) {
  return (
    <form className="fetch-form" onSubmit={onFetch} aria-busy={isFetching}>
      <label htmlFor={`${id}-url`}>Start with an article link</label>
      <div className="fetch-controls">
        <div className="url-input-wrap">
          <Link2 size={19} strokeWidth={1.5} aria-hidden="true" />
          <input id={`${id}-url`} name="url" type="url" placeholder="https://example.com/a-good-read"
            value={url} onChange={(event) => onUrlChange(event.target.value)} required disabled={disabled}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${id}-hint`} />
        </div>
        <button type="submit" disabled={!backendReady || disabled || !url.trim()}>
          {isFetching ? <><LoaderCircle className="spin" size={17} /> Fetching</> : <>Fetch article <ArrowUpRight size={18} strokeWidth={1.5} /></>}
        </button>
      </div>
      <p id={`${id}-hint`} className="field-hint">{backendReady
        ? "A blog post, a news story, a long read. Bring your own curiosity."
        : "Open the desktop app to connect the local extraction service."}</p>
      {isFetching && <p className="fetch-progress" role="status">Fetching the article and extracting its text…</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </form>
  );
}
