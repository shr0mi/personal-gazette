export type LocalProvider = "llama_cpp" | "ollama";
export type CloudProvider = "openai" | "anthropic" | "gemini" | "openrouter" | "azure" | "custom";
export type ModelConnection = {
  provider: LocalProvider | CloudProvider;
  model: string;
  base_url: string;
  api_key: string;
  api_version: string;
};
export type LLMPreferences = {
  mode: "local" | "cloud";
  local: ModelConnection;
  cloud: ModelConnection;
};
export type ActiveLLMSettings = ModelConnection & { mode: "local" | "cloud" };

export const cloudProviders: { value: CloudProvider; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Google Gemini" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "custom", label: "Other OpenAI-compatible provider" },
];

const storageKey = "local-summarizer.llm-settings.v1";
export const defaultPreferences: LLMPreferences = {
  mode: "local",
  local: { provider: "llama_cpp", model: "", base_url: "http://127.0.0.1:8080/v1", api_key: "", api_version: "" },
  cloud: { provider: "openai", model: "", base_url: "", api_key: "", api_version: "" },
};

export function activeSettings(preferences: LLMPreferences): ActiveLLMSettings {
  const connection = preferences[preferences.mode];
  return {
    ...connection,
    mode: preferences.mode,
    model: connection.model.trim(),
    base_url: connection.base_url.trim(),
    api_key: connection.api_key.trim(),
    api_version: connection.api_version.trim(),
  };
}

export function settingsError(preferences: LLMPreferences): string | null {
  const settings = activeSettings(preferences);
  if (!settings.model) return "Choose or enter a model name.";
  if (settings.mode === "cloud" && !settings.api_key) return "Enter your provider API key.";
  if (["azure", "custom"].includes(settings.provider) && !settings.base_url) return "Enter the provider API base URL.";
  if (settings.provider === "azure" && !settings.api_version) return "Enter the Azure API version.";
  if (settings.base_url) {
    try {
      const baseUrl = /^\d+$/.test(settings.base_url) && settings.mode === "local"
        ? `http://127.0.0.1:${settings.base_url}` : settings.base_url;
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
      if (settings.mode === "cloud" && parsed.protocol !== "https:") return "Use an HTTPS endpoint for cloud models.";
      if (settings.mode === "local" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return "Use localhost, 127.0.0.1, or ::1 for a local model.";
      const path = parsed.pathname.replace(/\/$/u, "");
      if (settings.provider === "llama_cpp" && !["", "/v1"].includes(path)) return "Use the llama.cpp server root URL or /v1 base URL.";
      if (settings.provider === "ollama" && !["", "/v1", "/api"].includes(path)) return "Use the Ollama server root URL.";
    } catch {
      return "Enter a valid server URL (or a local port).";
    }
  }
  return null;
}

export function loadPreferences(): LLMPreferences {
  const fallback = structuredClone(defaultPreferences);
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!stored || typeof stored !== "object") return fallback;
    if (["local", "cloud"].includes(stored.mode)) fallback.mode = stored.mode;
    for (const mode of ["local", "cloud"] as const) {
      const connection = stored[mode];
      const providers = mode === "local" ? ["llama_cpp", "ollama"] : cloudProviders.map((provider) => provider.value);
      if (!connection || !providers.includes(connection.provider)) continue;
      fallback[mode].provider = connection.provider;
      for (const field of ["model", "base_url", "api_version"] as const) {
        if (typeof connection[field] === "string") fallback[mode][field] = connection[field];
      }
    }
  } catch {
    // Corrupt or unavailable storage must not prevent the app from starting.
  }
  return fallback;
}

export function persistPreferences(preferences: LLMPreferences): void {
  const { api_key: localKey, ...local } = preferences.local;
  const { api_key: cloudKey, ...cloud } = preferences.cloud;
  void localKey;
  void cloudKey;
  localStorage.setItem(storageKey, JSON.stringify({ mode: preferences.mode, local, cloud }));
}

export function modelLabel(settings: ModelConnection): string {
  const provider = settings.provider === "llama_cpp" ? "llama.cpp"
    : settings.provider === "ollama" ? "Ollama"
    : cloudProviders.find((entry) => entry.value === settings.provider)?.label ?? settings.provider;
  return settings.model ? `${provider} · ${settings.model}` : provider;
}
