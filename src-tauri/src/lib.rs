mod backend_process;

use backend_process::BackendProcess;
use std::{net::TcpListener, sync::Mutex, time::Duration};
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::ShellExt;

struct BackendState {
    port: u16,
    token: String,
    child: Mutex<Option<BackendProcess>>,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct BackendHealth {
    status: String,
    service: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct ExtractedWebsite {
    url: String,
    text: String,
}

#[derive(serde::Deserialize)]
struct BackendError {
    detail: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct LlmSettings {
    mode: String,
    provider: String,
    model: String,
    base_url: String,
    api_key: String,
    api_version: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct ModelList {
    models: Vec<String>,
    base_url: String,
}

#[derive(serde::Serialize)]
struct SummaryRequest {
    text: String,
    settings: LlmSettings,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct ArticleSummary {
    title: String,
    summary: String,
    key_points: Vec<String>,
    model: String,
    mode: String,
    provider: String,
}

async fn backend_post<T: serde::Serialize, R: serde::de::DeserializeOwned>(
    state: &BackendState,
    path: &str,
    body: &T,
    timeout: Duration,
) -> Result<R, String> {
    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{}{path}", state.port))
        .header("X-Backend-Token", &state.token)
        .json(body)
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "The request took too long. Try again or use a smaller article.".to_string()
            } else {
                "Could not reach the local backend. Restart the app and try again.".to_string()
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(response
            .json::<BackendError>()
            .await
            .map(|error| error.detail)
            .unwrap_or_else(|_| {
                format!("The local backend could not complete the request ({status}).")
            }));
    }
    response
        .json::<R>()
        .await
        .map_err(|_| "The local backend returned an unreadable response.".to_string())
}

#[tauri::command]
async fn backend_health(state: State<'_, BackendState>) -> Result<BackendHealth, String> {
    reqwest::Client::new()
        .get(format!("http://127.0.0.1:{}/health", state.port))
        .header("X-Backend-Token", &state.token)
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<BackendHealth>()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn backend_extract(
    url: String,
    state: State<'_, BackendState>,
) -> Result<ExtractedWebsite, String> {
    let parsed_url = reqwest::Url::parse(url.trim())
        .map_err(|_| "Enter a valid website link, including https://.".to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") || parsed_url.host_str().is_none() {
        return Err("Enter an http:// or https:// website link.".to_string());
    }

    backend_post(
        &state,
        "/extract",
        &std::collections::HashMap::from([("url", parsed_url.as_str())]),
        Duration::from_secs(120),
    )
    .await
}

#[tauri::command]
async fn backend_models(
    settings: LlmSettings,
    state: State<'_, BackendState>,
) -> Result<ModelList, String> {
    backend_post(&state, "/llm/models", &settings, Duration::from_secs(20)).await
}

#[tauri::command]
async fn backend_summarize(
    text: String,
    settings: LlmSettings,
    state: State<'_, BackendState>,
) -> Result<ArticleSummary, String> {
    backend_post(
        &state,
        "/summarize",
        &SummaryRequest { text, settings },
        Duration::from_secs(240),
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The API listens only on loopback. Let the OS select an available port.
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);

            let token = uuid::Uuid::new_v4().to_string();
            let command = app
                .shell()
                .sidecar("deep-websearch-api")?
                .args(["--port", &port.to_string(), "--parent-stdin"])
                .env("DEEP_WEBSEARCH_TOKEN", &token);
            let child = BackendProcess::spawn(command.into())?;

            app.manage(BackendState {
                port,
                token,
                child: Mutex::new(Some(child)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_health,
            backend_extract,
            backend_models,
            backend_summarize
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Ok(mut child) = app_handle.state::<BackendState>().child.lock() {
                if let Some(child) = child.take() {
                    child.shutdown();
                }
            }
        }
    });
}
