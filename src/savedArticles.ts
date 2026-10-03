export type SummaryResult = {
  // Older saved summaries predate generated headings.
  title?: string;
  summary: string;
  key_points: string[];
  model: string;
  mode: "local" | "cloud";
  provider: string;
};

export type ArticleSummary = SummaryResult | {
  title?: never;
  summary: string;
  key_points: string[];
  mode: "manual";
  model?: never;
  provider?: never;
};

export type SavedArticle = {
  id: string;
  url: string;
  title: string;
  summary: ArticleSummary;
  savedAt: string;
  updatedAt: string;
  isFavorite: boolean;
};

const storageKey = "local-summarizer.saved-articles.v1";

export function articleUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid article link.");
  parsed.hash = "";
  return parsed.href;
}

export function titleFromUrl(value: string): string {
  const parsed = new URL(value);
  const slug = parsed.pathname.split("/").filter(Boolean).pop();
  if (!slug) return parsed.hostname;
  try {
    return decodeURIComponent(slug).replace(/[-_]+/gu, " ").slice(0, 200);
  } catch {
    return parsed.hostname;
  }
}

function summaryFields(result: ArticleSummary): ArticleSummary {
  // Persist only the result, never extracted text or connection credentials.
  if (result.mode === "manual") {
    return { summary: result.summary, key_points: [...result.key_points], mode: "manual" };
  }
  return {
    ...(result.title !== undefined ? { title: result.title } : {}),
    summary: result.summary,
    key_points: [...result.key_points],
    model: result.model,
    mode: result.mode,
    provider: result.provider,
  };
}

export function titleAfterSummary(
  title: string, previous: ArticleSummary | null, next: SummaryResult, url: string,
): string {
  const previousTitle = previous?.title ?? titleFromUrl(url);
  // Update automatic headings, keeping the reader's own title across generations.
  return next.title && title.trim() === previousTitle ? next.title : title;
}

export function saveArticle(
  articles: SavedArticle[], url: string, title: string, summary: ArticleSummary,
): SavedArticle[] {
  const normalizedUrl = articleUrl(url);
  const existing = articles.find((article) => article.url === normalizedUrl);
  const now = new Date().toISOString();
  const article: SavedArticle = {
    id: existing?.id ?? crypto.randomUUID(),
    url: normalizedUrl,
    title: title.trim() || titleFromUrl(normalizedUrl),
    summary: summaryFields({ ...summary, summary: summary.summary.trim(), key_points: summary.key_points.map((point) => point.trim()).filter(Boolean) }),
    savedAt: existing?.savedAt ?? now,
    updatedAt: now,
    isFavorite: existing?.isFavorite ?? false,
  };
  return [article, ...articles.filter((entry) => entry.id !== article.id)];
}

export function persistSavedArticles(articles: SavedArticle[]): void {
  const records = articles.map((article) => ({
    id: article.id,
    url: article.url,
    title: article.title,
    summary: summaryFields(article.summary),
    savedAt: article.savedAt,
    updatedAt: article.updatedAt,
    isFavorite: article.isFavorite,
  }));
  localStorage.setItem(storageKey, JSON.stringify(records));
}

export function loadSavedArticles(): SavedArticle[] {
  const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
  if (!Array.isArray(stored)) throw new Error("Invalid saved articles.");
  const ids = new Set<string>();
  const urls = new Set<string>();
  return stored.map((record) => {
    if (!record || typeof record !== "object") throw new Error("Invalid saved article.");
    const { id, url, title, summary, savedAt, updatedAt, isFavorite } = record;
    if (
      typeof id !== "string" || !id || ids.has(id) ||
      typeof url !== "string" || typeof title !== "string" || !title.trim() ||
      typeof savedAt !== "string" || !Number.isFinite(Date.parse(savedAt)) ||
      typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)) ||
      (isFavorite !== undefined && typeof isFavorite !== "boolean") ||
      !summary || typeof summary.summary !== "string" || !summary.summary.trim() ||
      (summary.title !== undefined && (typeof summary.title !== "string" || !summary.title.trim() || summary.title.length > 200)) ||
      !Array.isArray(summary.key_points) || !summary.key_points.every((point: unknown) => typeof point === "string") ||
      !["manual", "local", "cloud"].includes(summary.mode) ||
      (summary.mode !== "manual" && (typeof summary.model !== "string" || typeof summary.provider !== "string"))
    ) throw new Error("Invalid saved article.");
    const normalizedUrl = articleUrl(url);
    if (urls.has(normalizedUrl)) throw new Error("Duplicate saved article.");
    ids.add(id);
    urls.add(normalizedUrl);
    return { id, url: normalizedUrl, title, summary: summaryFields(summary), savedAt, updatedAt, isFavorite: isFavorite ?? false };
  });
}

export function toggleArticleFavorite(articles: SavedArticle[], id: string): SavedArticle[] {
  return articles.map((article) => article.id === id ? { ...article, isFavorite: !article.isFavorite } : article);
}

export function sortedArticles(articles: SavedArticle[]): SavedArticle[] {
  return [...articles].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

type RefreshServices = {
  extract: (url: string) => Promise<{ text: string }>;
  summarize: (text: string) => Promise<SummaryResult>;
};

export async function refreshSavedArticle(
  article: SavedArticle, services: RefreshServices,
): Promise<SavedArticle> {
  const extracted = await services.extract(article.url);
  if (!extracted.text.trim()) throw new Error("No readable article text was found.");
  const summary = await services.summarize(extracted.text);
  return {
    ...article,
    title: titleAfterSummary(article.title, article.summary, summary, article.url),
    summary: summaryFields(summary),
    updatedAt: new Date().toISOString(),
  };
}
