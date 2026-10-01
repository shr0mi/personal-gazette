use std::{net::TcpListener, sync::Mutex, time::Duration};
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct BackendState {
    port: u16,
    token: String,
    child: Mutex<Option<CommandChild>>,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct BackendHealth {
    status: String,
    service: String,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // The API listens only on loopback. Let the OS select an available port.
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);

            let token = uuid::Uuid::new_v4().to_string();
            let (mut events, child) = app
                .shell()
                .sidecar("deep-websearch-api")?
                .args(["--port", &port.to_string()])
                .env("DEEP_WEBSEARCH_TOKEN", &token)
                .spawn()?;

            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            eprintln!("sidecar: {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("sidecar: {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("sidecar exited: {status:?}");
                        }
                        _ => {}
                    }
                }
            });

            app.manage(BackendState {
                port,
                token,
                child: Mutex::new(Some(child)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_health])
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Ok(mut child) = app_handle.state::<BackendState>().child.lock() {
                if let Some(child) = child.take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
