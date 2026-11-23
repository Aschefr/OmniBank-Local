fn main() {
    // La page de l'app vient du serveur local (http://127.0.0.1:8434) : pour Tauri, c'est une origine distante, qui
    // n'a droit qu'aux commandes déclarées ici puis autorisées dans capabilities/default.json.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["get_app_version"])),
    )
    .expect("failed to run tauri-build");
}
