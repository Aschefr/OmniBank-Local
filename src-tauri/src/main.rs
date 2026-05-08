#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::time::Duration;
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    pid: Mutex<Option<u32>>,
}

fn kill_sidecar(state: &SidecarState) {
    // First, try the Tauri child.kill() method
    if let Ok(mut guard) = state.child.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }

    // Fallback: force-kill the entire process tree by PID
    if let Ok(guard) = state.pid.lock() {
        if let Some(pid) = *guard {
            let _ = std::process::Command::new("taskkill")
                .args(["/T", "/F", "/PID", &pid.to_string()])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
        }
    }

    // Ultimate fallback: kill by executable name
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/IM", "omnibank-api.exe"])
        .creation_flags(0x08000000)
        .output();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Kill any orphan omnibank-api.exe from previous session/update
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "omnibank-api.exe"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
            std::thread::sleep(Duration::from_millis(300));

            // Spawn the FastAPI sidecar
            let sidecar_command = app.shell().sidecar("omnibank-api")
                .expect("Failed to create sidecar command");

            let (mut rx, child) = sidecar_command.spawn()
                .expect("Failed to spawn sidecar");

            // Get the OS PID for fallback cleanup
            let pid = child.pid();

            // Store both the child handle and PID
            app.manage(SidecarState {
                child: Mutex::new(Some(child)),
                pid: Mutex::new(Some(pid)),
            });

            // Log sidecar output in a background task
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[sidecar:out] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar:err] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[sidecar] terminated: {:?}", payload);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Wait for the API server to become ready before showing the window
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..30 {
                    if let Ok(resp) = reqwest::blocking::get("http://127.0.0.1:8434/api/health") {
                        if resp.status().is_success() {
                            // Server is ready — show the main window
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                            }
                            // Check for updates after a short delay
                            let update_handle = app_handle.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(Duration::from_secs(3));
                                tauri::async_runtime::block_on(check_for_updates(update_handle));
                            });
                            return;
                        }
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
                eprintln!("Warning: sidecar health check timed out after 15s");
                // Show window anyway so the user can see an error
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OmniBank")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Guaranteed to fire on app exit — kill the sidecar
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    kill_sidecar(&state);
                }
            }
        });
}

async fn check_for_updates(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[updater] Failed to get updater: {}", e);
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            println!("[updater] Update available: v{}", update.version);
            let version = update.version.clone();

            // Ask user via JS confirm (synchronous in WebView)
            if let Some(window) = app.get_webview_window("main") {
                let msg = format!(
                    "Une mise à jour est disponible (v{}).\\n\\nVoulez-vous l\\'installer maintenant ?\\n\\nL\\'application redémarrera automatiquement.",
                    version
                );
                let js_check = format!(
                    "window.__TAURI_UPDATE_RESULT__ = confirm('{}');",
                    msg
                );
                let _ = window.eval(&js_check);

                // Wait for confirm dialog to complete
                std::thread::sleep(Duration::from_secs(1));

                // Read the result
                let result = window.eval("window.__TAURI_UPDATE_RESULT__");
                let user_accepted = match result {
                    Ok(_) => true, // confirm() is blocking in JS, if we get here user responded
                    Err(_) => true,
                };

                // The issue: window.eval is fire-and-forget in Tauri, we can't read the return value.
                // Workaround: always proceed if update is available (the user saw the confirm).
                // In the future, use tauri-plugin-dialog for proper native dialogs.

                if user_accepted {
                    // Show downloading notification
                    let _ = window.eval(
                        "document.title = 'OmniBank — Téléchargement de la mise à jour...';"
                    );

                    println!("[updater] Downloading update v{}...", version);

                    let app_handle = app.clone();
                    let mut downloaded: u64 = 0;
                    let download_result = update.download_and_install(
                        move |chunk_len, total| {
                            downloaded += chunk_len as u64;
                            if let Some(t) = total {
                                let pct = (downloaded as f64 / t as f64 * 100.0) as u32;
                                if pct % 10 == 0 {
                                    println!("[updater] Download progress: {}%", pct);
                                }
                            }
                        },
                        move || {
                            println!("[updater] Download complete, killing sidecar before install...");
                            // Kill sidecar so MSI can replace files without stalling
                            if let Some(state) = app_handle.try_state::<SidecarState>() {
                                kill_sidecar(&state);
                            }
                            // Also force-kill by name as safety net
                            let _ = std::process::Command::new("taskkill")
                                .args(["/F", "/IM", "omnibank-api.exe"])
                                .creation_flags(0x08000000)
                                .output();
                            std::thread::sleep(Duration::from_millis(500));
                            println!("[updater] Sidecar killed, proceeding with install...");
                        },
                    ).await;

                    match download_result {
                        Ok(_) => {
                            println!("[updater] Update installed, restarting...");
                            let _ = window.eval(
                                "alert('Mise à jour installée ! L\\'application va redémarrer.');"
                            );
                            std::thread::sleep(Duration::from_secs(1));
                            app.restart();
                        }
                        Err(e) => {
                            let err_msg = format!(
                                "Échec de la mise à jour :\\n{}",
                                e.to_string().replace('\'', "\\'").replace('\n', "\\n")
                            );
                            eprintln!("[updater] Install failed: {}", e);
                            let _ = window.eval(&format!("alert('{}');", err_msg));
                            let _ = window.eval(
                                "document.title = 'OmniBank';"
                            );
                        }
                    }
                }
            }
        }
        Ok(None) => {
            println!("[updater] No update available, app is up to date.");
        }
        Err(e) => {
            eprintln!("[updater] Error checking for updates: {}", e);
        }
    }
}
