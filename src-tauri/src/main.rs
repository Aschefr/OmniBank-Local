#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind, MessageDialogButtons};
use std::time::Duration;
use std::sync::Mutex;
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct SidecarState {
    // OLD WAY (ONEFILE)
    // child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    // NEW WAY (ONEDIR)
    child: Mutex<Option<std::process::Child>>,
    pid: Mutex<Option<u32>>,
}

fn kill_sidecar(state: &SidecarState) {
    // First, try the child.kill() method
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
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

/// Nettoie silencieusement les résidus des mises à jour précédentes.
/// N'efface QUE les fichiers générés par le mécanisme d'update Tauri/WiX :
///   - Fichiers .msi.partial dans %TEMP% liés à OmniBank
///   - Caches d'extraction PyInstaller --onefile (_MEI* avec marqueur omnibank-api.exe)
///   - Fichiers update*.msi téléchargés par tauri-plugin-updater dans %TEMP%
///   - Fichiers OmniBank*.msi dans %LOCALAPPDATA%\Temp
///
/// JAMAIS touchés : base de données, licence, configuration utilisateur.
fn cleanup_old_update_artifacts() {
    let temp_dir = match std::env::var("TEMP").or_else(|_| std::env::var("TMP")) {
        Ok(t) => PathBuf::from(t),
        Err(_) => return,
    };

    // 1. Résidus PyInstaller --onefile (_MEI*) des anciennes versions
    //    Ces dossiers sont créés à chaque lancement et non nettoyés si crash/update
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("_MEI") && entry.path().is_dir() {
                // Vérifier marqueur omnibank-api pour éviter de supprimer d'autres apps
                let api_marker = entry.path().join("omnibank-api.exe");
                if api_marker.exists() {
                    eprintln!("[cleanup] Suppression résidu PyInstaller: {:?}", entry.path());
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }

    // 2. Fichiers .msi partiels ou MSI OmniBank résiduels dans %TEMP%
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_lowercase();
            let is_omnibank_msi = name_str.contains("omnibank") &&
                (name_str.ends_with(".msi") || name_str.ends_with(".msi.partial"));
            if is_omnibank_msi && entry.path().is_file() {
                eprintln!("[cleanup] Suppression MSI résidu: {:?}", entry.path());
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    // 3. Cache WiX dans %LOCALAPPDATA%\Temp (uniquement fichiers OmniBank)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let wix_temp = PathBuf::from(&local_app_data).join("Temp");
        if let Ok(entries) = std::fs::read_dir(&wix_temp) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy().to_lowercase();
                if name_str.contains("omnibank") && entry.path().is_file() {
                    eprintln!("[cleanup] Suppression cache LOCALAPPDATA\\Temp: {:?}", entry.path());
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    eprintln!("[cleanup] Nettoyage post-MAJ terminé.");
}


#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.config().version.clone().unwrap_or_else(|| "?".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_app_version])

        .setup(|app| {
            // Nettoyage silencieux des résidus de mises à jour précédentes (thread background)
            std::thread::spawn(cleanup_old_update_artifacts);

            // Kill any orphan omnibank-api.exe from previous session/update
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "omnibank-api.exe"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
            std::thread::sleep(Duration::from_millis(100));

            // Spawn the FastAPI sidecar

            
            /* OLD WAY (ONEFILE)
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
            */
            
            // NEW WAY (ONEDIR)
            use std::process::Stdio;
            let resource_dir = app.path().resource_dir().expect("Failed to get resource dir");
            let exe_path = resource_dir.join("resources").join("omnibank-api").join("omnibank-api.exe");
            
            let mut child = std::process::Command::new(exe_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn()
                .expect("Failed to spawn sidecar from resources");
                
            let pid = child.id();
            
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            
            app.manage(SidecarState {
                child: Mutex::new(Some(child)),
                pid: Mutex::new(Some(pid)),
            });
            
            // Log sidecar output in a background thread
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                if let Some(out) = stdout {
                    let reader = BufReader::new(out);
                    for line in reader.lines() {
                        if let Ok(l) = line { println!("[sidecar:out] {}", l); }
                    }
                }
            });
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                if let Some(err) = stderr {
                    let reader = BufReader::new(err);
                    for line in reader.lines() {
                        if let Ok(l) = line { eprintln!("[sidecar:err] {}", l); }
                    }
                }
            });

            // Wait for the API server to become ready before showing the window
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..30 {
                    if let Ok(resp) = reqwest::blocking::get("http://127.0.0.1:8434/api/health") {
                        if resp.status().is_success() {
                            // Server is ready — reload page (clears the ERR_CONNECTION_REFUSED) then show
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.navigate("http://127.0.0.1:8434".parse().unwrap());
                                // Wait for WebView to fully load the page (window is still hidden)
                                std::thread::sleep(Duration::from_millis(200));
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
                    std::thread::sleep(Duration::from_millis(200));
                }
                eprintln!("Warning: sidecar health check timed out after 15s");
                // Show window anyway so the user can see an error
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.navigate("http://127.0.0.1:8434".parse().unwrap());
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
