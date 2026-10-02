import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  activeSettings, cloudProviders, settingsError,
  type CloudProvider, type LLMPreferences, type LocalProvider, type ModelConnection,
} from "./llmSettings";

type Props = {
  preferences: LLMPreferences;
  backendReady: boolean;
  onSave: (preferences: LLMPreferences) => void;
  onCancel: () => void;
};
type ModelList = { models: string[]; base_url: string };

export default function SettingsPage({ preferences, backendReady, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<LLMPreferences>(() => structuredClone(preferences));
  const [models, setModels] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<string | null>(null);
  const connection = draft[draft.mode];

  const updateConnection = (change: Partial<ModelConnection>) => {
    setDraft((current) => ({ ...current, [current.mode]: { ...current[current.mode], ...change } }));
    setError(null);
    setDiscoveryMessage(null);
    if ("base_url" in change || "provider" in change || "api_key" in change) setModels([]);
  };

  const discoverModels = async () => {
    setIsDiscovering(true);
    setError(null);
    setDiscoveryMessage(null);
    setModels([]);
    try {
      const result = await invoke<ModelList>("backend_models", { settings: activeSettings(draft) });
      setModels(result.models);
      setDraft((current) => ({ ...current, local: {
        ...current.local,
        base_url: result.base_url,
        model: result.models.includes(current.local.model) ? current.local.model : result.models[0],
      } }));
      setDiscoveryMessage(`Found ${result.models.length} ${result.models.length === 1 ? "model" : "models"}. Review the selection below.`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setIsDiscovering(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = settingsError(draft);
    if (validationError) { setError(validationError); return; }
    onSave(draft);
  };

  return (
    <>
      <h1>Model settings.</h1>
      <p className="intro">Choose where your summary is generated. Local models run on your device; cloud models use your provider account.</p>
      <form className="settings-card" onSubmit={save}>
        <fieldset className="mode-picker" disabled={isDiscovering}>
          <legend>Run the model</legend>
          <label className={`mode-option ${draft.mode === "local" ? "selected" : ""}`}>
            <input type="radio" name="llm-mode" value="local" checked={draft.mode === "local"} onChange={() => { setDraft({ ...draft, mode: "local" }); setError(null); }} />
            <span>Local <small>llama.cpp or Ollama</small></span>
          </label>
          <label className={`mode-option ${draft.mode === "cloud" ? "selected" : ""}`}>
            <input type="radio" name="llm-mode" value="cloud" checked={draft.mode === "cloud"} onChange={() => { setDraft({ ...draft, mode: "cloud" }); setError(null); }} />
            <span>Cloud <small>Your provider and API key</small></span>
          </label>
        </fieldset>

        <fieldset className="connection-fields" disabled={isDiscovering}>
          <legend className="visually-hidden">Connection details</legend>
          <div className="settings-field">
            <label htmlFor="llm-provider">{draft.mode === "local" ? "Local server" : "Cloud provider"}</label>
            <select id="llm-provider" value={connection.provider} onChange={(event) => {
              if (draft.mode === "local") {
                const provider = event.target.value as LocalProvider;
                updateConnection({ provider, model: "", api_key: "", base_url: provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:8080/v1" });
              } else {
                updateConnection({ provider: event.target.value as CloudProvider, model: "", api_key: "", base_url: "", api_version: "" });
              }
            }}>
              {draft.mode === "local" ? <><option value="llama_cpp">llama.cpp</option><option value="ollama">Ollama</option></>
                : cloudProviders.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
            </select>
          </div>

          <div className="settings-field">
            <label htmlFor="llm-base-url">{draft.mode === "local" ? "Server URL or port" : `API base URL ${["azure", "custom"].includes(connection.provider) ? "" : "(optional)"}`}</label>
            <div className="fetch-controls">
              <input id="llm-base-url" type="text" value={connection.base_url} onChange={(event) => updateConnection({ base_url: event.target.value })}
                placeholder={draft.mode === "local" ? (connection.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:8080/v1") : (connection.provider === "azure" ? "https://your-resource.openai.azure.com" : "https://your-provider.example/v1")}
                required={draft.mode === "local" || ["azure", "custom"].includes(connection.provider)} maxLength={2083} spellCheck={false} autoCapitalize="none" aria-describedby="server-hint" />
              {draft.mode === "local" && <button type="button" onClick={() => void discoverModels()} disabled={!backendReady || !connection.base_url.trim()}>Load models</button>}
            </div>
            <p className="field-hint" id="server-hint">
              {draft.mode === "local" ? "Start your local server first. You can enter just its port; Load models finds the model names for you."
                : connection.provider === "azure" ? "Use your Azure resource endpoint. The deployment name goes in the model field."
                : "Leave blank to use the provider's default endpoint. For a compatible provider, include the /v1 base path."}
            </p>
          </div>

          <div className="settings-field">
            <label htmlFor="llm-model">{connection.provider === "azure" ? "Deployment name" : "Model name"}</label>
            <input id="llm-model" list={draft.mode === "local" ? "local-models" : undefined} value={connection.model} onChange={(event) => updateConnection({ model: event.target.value })}
              placeholder={draft.mode === "local" ? "Load models or enter the server's model name" : connection.provider === "openrouter" ? "provider/model-name" : "Model ID from your provider"}
              required maxLength={500} autoCapitalize="none" spellCheck={false} />
            <datalist id="local-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
            <p className="field-hint">{draft.mode === "local" ? "Use an instruction-tuned model with a chat template. Ollama models must already be installed."
              : "Enter the exact model ID. OpenRouter IDs include their provider prefix."}</p>
          </div>

          <div className="settings-field">
            <label htmlFor="llm-api-key">API key {draft.mode === "local" ? "(optional)" : ""}</label>
            <input id="llm-api-key" type="password" value={connection.api_key} onChange={(event) => updateConnection({ api_key: event.target.value })}
              placeholder={draft.mode === "local" ? "Only if your local server requires a key" : "Your provider API key"}
              required={draft.mode === "cloud"} autoComplete="off" spellCheck={false} aria-describedby="key-hint" />
            <p id="key-hint" className="field-hint">API keys stay in memory for this session. Re-enter them after restarting the app.</p>
          </div>

          {connection.provider === "azure" && <div className="settings-field">
            <label htmlFor="llm-api-version">Azure API version</label>
            <input id="llm-api-version" value={connection.api_version} onChange={(event) => updateConnection({ api_version: event.target.value })} placeholder="API version supported by your deployment" required maxLength={100} spellCheck={false} />
          </div>}
        </fieldset>
        <div aria-live="polite" aria-atomic="true">
          {isDiscovering && <p className="fetch-progress">Connecting to your local server…</p>}
          {discoveryMessage && <p className="fetch-success">{discoveryMessage}</p>}
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <p className="privacy-note">{draft.mode === "local" ? "Article text is sent only to the local server you choose."
          : "Summarizing sends the current article text to this cloud provider and may incur usage charges."}</p>
        <div className="settings-actions">
          <button type="submit" disabled={isDiscovering}>Save settings</button>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={isDiscovering}>Cancel</button>
        </div>
      </form>
    </>
  );
}
