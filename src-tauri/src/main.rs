#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind, MessageDialogButtons};
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
        .plugin(tauri_plugin_dialog::init())
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

            // Ask user via native dialog (must run on a separate thread, NOT tokio worker)
            let msg = format!(
                "Une mise a jour est disponible (v{}).\n\nVoulez-vous l'installer maintenant ?\n\nL'application va redemarrer automatiquement.",
                version
            );

            let app_for_dialog = app.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let accepted = app_for_dialog.dialog()
                    .message(&msg)
                    .title("Mise a jour OmniBank")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancel)
                    .blocking_show();
                let _ = tx.send(accepted);
            });
            let user_accepted = rx.recv().unwrap_or(false);

            if user_accepted {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(
                        "document.title = 'OmniBank — Téléchargement de la mise à jour...';"
                    );
                }

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
                        if let Some(state) = app_handle.try_state::<SidecarState>() {
                            kill_sidecar(&state);
                        }
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
                        let app2 = app.clone();
                        let handle = std::thread::spawn(move || {
                            app2.dialog()
                                .message("Mise a jour installee ! L'application va redemarrer.")
                                .title("OmniBank")
                                .kind(MessageDialogKind::Info)
                                .buttons(MessageDialogButtons::Ok)
                                .blocking_show();
                        });
                        let _ = handle.join();
                        app.restart();
                    }
                    Err(e) => {
                        eprintln!("[updater] Install failed: {}", e);
                        let app2 = app.clone();
                        let err_msg = format!("Echec de la mise a jour :\n{}", e);
                        let handle = std::thread::spawn(move || {
                            app2.dialog()
                                .message(&err_msg)
                                .title("Erreur de mise a jour")
                                .kind(MessageDialogKind::Error)
                                .blocking_show();
                        });
                        let _ = handle.join();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.eval("document.title = 'OmniBank';");
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
