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

type StoredApiKeys = { version: 1; key: string; iv: string; ciphertext: string };

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptApiKeys(preferences: LLMPreferences): Promise<StoredApiKeys | null> {
  if (!preferences.local.api_key && !preferences.cloud.api_key) return null;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ local: preferences.local.api_key, cloud: preferences.cloud.api_key }));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  // Keep the key with the ciphertext so restoration needs no password. This only
  // deters casual inspection; access to app storage allows recovery of the keys.
  return {
    version: 1,
    key: toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptApiKeys(stored: StoredApiKeys): Promise<{ local: string; cloud: string }> {
  if (stored.version !== 1 || typeof stored.key !== "string" || typeof stored.iv !== "string" || typeof stored.ciphertext !== "string") throw new Error("Invalid saved API keys.");
  const keyBytes = fromBase64(stored.key);
  const iv = fromBase64(stored.iv);
  if (keyBytes.length !== 32 || iv.length !== 12) throw new Error("Invalid saved API keys.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, fromBase64(stored.ciphertext));
  const keys = JSON.parse(new TextDecoder().decode(plaintext));
  if (typeof keys?.local !== "string" || typeof keys?.cloud !== "string") throw new Error("Invalid saved API keys.");
  return keys;
}

export async function loadPreferences(): Promise<LLMPreferences> {
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
    if (stored.api_keys) {
      try {
        const keys = await decryptApiKeys(stored.api_keys);
        for (const mode of ["local", "cloud"] as const) {
          if (stored[mode]?.provider === fallback[mode].provider) fallback[mode].api_key = keys[mode];
        }
      } catch {
        // Keep usable connection details if credentials cannot be decrypted.
        // The original stored data is left untouched until settings are saved.
      }
    }
  } catch {
    // Corrupt or unavailable storage must not prevent the app from starting.
  }
  return fallback;
}

export async function persistPreferences(preferences: LLMPreferences): Promise<void> {
  // Snapshot before awaiting encryption so later edits cannot mix settings and keys.
  const snapshot = structuredClone(preferences);
  const { api_key: localKey, ...local } = snapshot.local;
  const { api_key: cloudKey, ...cloud } = snapshot.cloud;
  void localKey;
  void cloudKey;
  const api_keys = await encryptApiKeys(snapshot);
  // One write keeps credentials and their decryption key together if storage fails.
  localStorage.setItem(storageKey, JSON.stringify({ mode: snapshot.mode, local, cloud, api_keys }));
}

export function modelLabel(settings: { provider: string; model: string }): string {
  const provider = settings.provider === "llama_cpp" ? "llama.cpp"
    : settings.provider === "ollama" ? "Ollama"
    : cloudProviders.find((entry) => entry.value === settings.provider)?.label ?? settings.provider;
  return settings.model ? `${provider} · ${settings.model}` : provider;
}
