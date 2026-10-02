# Local Summarizer

A local-first summarizer with a React and TypeScript interface, a Tauri/Rust host, and a local FastAPI sidecar. Paste a website URL and click **fetch** to extract article text with Trafilatura on your device. Expand **Extracted text** to review and edit it, then click **Summarize** to generate a summary and key points with your configured local or cloud model through LiteLLM.

## Prerequisites

- Node.js and npm
- Rust with a desktop host target (`rustc --print host-tuple`)
- Python 3.11 or newer with `venv` and `pip`
- The [Tauri desktop prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

Dependencies are installed in this repository's `node_modules` and `.venv`. No global npm, Cargo, or Python package installation is needed.

## Run locally

```sh
npm install
npm run setup:python
npm run dev:desktop
```

`dev:desktop` builds the Python executable and starts Vite and Tauri. PyInstaller's first run may take a few seconds; the interface waits up to 30 seconds for the API to become ready.

Fetching a website requires an internet connection. Extracted text and edits stay in React state for the current session, and a successful new fetch replaces them. Failed fetches preserve the previous text and edits. Pages that require JavaScript, a login, or block automated downloads may not be extractable.

`npm run dev` alone serves the interface; the fetch workflow requires `npm run dev:desktop` to provide the local backend connection.

## Configure a model

Open **Settings**, choose **Local** or **Cloud**, enter the connection details, and click **Save settings**. Non-secret preferences save on your device. API keys stay in memory for the session and must be entered again after restarting; they are never written to browser storage or a settings file.

### llama.cpp

Start `llama-server` with an instruction-tuned GGUF model and enough context for your articles, for example:

```sh
llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080 --alias local-model -c 8192
```

Choose **llama.cpp**, use `http://127.0.0.1:8080/v1` (or enter just `8080`), and click **Load models**. The app normalizes the `/v1` base path and discovers the model IDs from `/v1/models`. Select the model and save. Enter an API key only if your server requires one. See the [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).

### Ollama

Start Ollama and install the model you want to use:

```sh
ollama serve
ollama pull <model-name>
```

Choose **Ollama**, use `http://127.0.0.1:11434` (or enter `11434`), and click **Load models**. Discovery uses `/api/tags`; LiteLLM's `ollama_chat` adapter sends generation requests to `/api/chat`. See [LiteLLM's Ollama integration](https://docs.litellm.ai/docs/providers/ollama). Local mode accepts loopback addresses only and never falls back to a cloud model.

### Cloud providers

Choose OpenAI, Anthropic, Google Gemini, OpenRouter, Azure OpenAI, or another OpenAI-compatible provider. Enter the exact model ID and your API key. OpenRouter IDs include the upstream provider (for example, `provider/model-name`). Azure also requires the resource endpoint, API version, and deployment name. A custom compatible provider requires an HTTPS API base URL, usually ending in `/v1`. Standard providers use their default endpoints unless you provide an override. See [LiteLLM's compatible endpoints](https://docs.litellm.ai/docs/providers/openai_compatible).

Clicking **Summarize** in cloud mode sends the current edited article text to that provider and may incur charges. Local mode sends it only to your configured local server. Summarization is explicit so you can review the extracted text first. If you edit the text after generating a summary, the output is marked as out of date until you regenerate it.

## Build a desktop bundle

```sh
npm run build:desktop
```

The build command packages a sidecar for the machine's current Rust host target. Build on each target operating system and architecture; the PyInstaller step is not a cross compiler.

## Project layout

- `src/` — React article editor, model settings, and summary output.
- `src-tauri/` — Rust desktop host; starts, monitors, and stops the sidecar.
- `backend/` — FastAPI app and executable entry point.
- `scripts/` — local Python setup and sidecar packaging.

The Rust host chooses a free loopback port and passes a random token to the sidecar through its environment. The Python API binds to `127.0.0.1`, and all routes require that token. The frontend talks through Tauri commands, so it does not need direct network access or the token.

## Extraction API

`POST /extract` receives `{"url": "https://example.com/article"}` and returns `{"url": "https://example.com/article", "text": "Extracted article text…"}`. It accepts HTTP and HTTPS URLs, uses Trafilatura to download and extract the main text (including tables, excluding comments), and runs in FastAPI's thread pool so fetching does not block health checks. The `X-Backend-Token` header must match `DEEP_WEBSEARCH_TOKEN`.

Errors return a JSON `detail`: `401` for an invalid token, `422` for invalid input or no readable article text, `502` for download failures, and `500` for an unexpected extraction failure. Extraction follows [Trafilatura's Python workflow](https://trafilatura.readthedocs.io/en/latest/quickstart.html).

`POST /llm/models` accepts the active local model settings and returns `{"models": ["model-id"], "base_url": "http://127.0.0.1:8080/v1"}`.

`POST /summarize` accepts `{"text": "Current edited article text", "settings": {"mode": "local", "provider": "llama_cpp", "model": "local-model", "base_url": "http://127.0.0.1:8080/v1", "api_key": "", "api_version": ""}}`. It returns `summary`, `key_points`, and the model/provider/mode used. All routes require the desktop token. Model calls time out after 180 seconds and do not retry automatically. Invalid output, unavailable servers, credentials, quotas, and context limits produce readable errors. The full text is sent without silent truncation; input is limited to 200,000 characters and the selected model's context window.

## Verify changes

```sh
.venv/bin/python -m pip install -r backend/requirements-dev.txt
.venv/bin/python -m unittest discover -s backend/tests -v
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

The API tests use an HTML fixture and the real Trafilatura extractor; downloads and model providers are mocked so tests work offline. Tests cover local/cloud routing, edited text, model discovery, malformed responses, and credential redaction. On Windows, use `.venv/Scripts/python.exe` in place of `.venv/bin/python`.
